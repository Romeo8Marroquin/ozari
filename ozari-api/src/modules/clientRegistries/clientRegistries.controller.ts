import type { Response } from "express";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { encryptKms } from "@helpers/encryption.js";
import { encodeCoords } from "@helpers/geo.js";
import { appConfig } from "@/config/app.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { buildPaginationMeta } from "../products/products.service.js";
import {
  type ClientRegistryEnvelopeModel,
  type ClientRegistryListResponseModel,
  type CreateClientRegistryRequestModel,
} from "./clientRegistries.models.js";
import {
  projectClientRegistry,
  richRegistryInclude,
} from "./clientRegistries.service.js";

/** The list's clamped pagination (names are ENCRYPTED, so search happens client-side over pages —
 *  a micro-business's registry fits in a couple of fetches). */
const parseRegistryListQuery = (query: unknown): { page: number; pageSize: number } => {
  const source = (query ?? {}) as Record<string, unknown>;
  const rawPage = Number(source["page"]);
  const rawPageSize = Number(source["pageSize"]);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const pageSize =
    Number.isInteger(rawPageSize) && rawPageSize >= 1
      ? Math.min(rawPageSize, appConfig.maxOrderPageSize)
      : appConfig.defaultOrderPageSize;
  return { page, pageSize };
};

/**
 * `GET /client-registries` — the admin's walk-in client list (the order form's picker). **Admin
 * only**: registries are the admin's WhatsApp-clients tool; no other role ever reads them. Active
 * rows only (a soft-deleted registry is a migrated/retired client), newest first, decrypted.
 */
export const getClientRegistries = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const { page, pageSize } = parseRegistryListQuery(req.query);
    const prismaClient = await getPrismaClient();
    const where = { isActive: true } as const;
    const [rows, total] = await Promise.all([
      prismaClient.clientRegistry.findMany({
        where,
        include: richRegistryInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prismaClient.clientRegistry.count({ where }),
    ]);

    const response: ClientRegistryListResponseModel = {
      registries: rows.map(projectClientRegistry),
      pagination: buildPaginationMeta(page, pageSize, total),
    };
    logger.info(
      i18next.t("clientRegistries.getRegistries.logs.registriesFetched", { count: total }),
    );
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("clientRegistries.getRegistries.registriesFetched"),
      response,
    );
  } catch (error) {
    logger.error(
      i18next.t("clientRegistries.getRegistries.logs.errorFetchingRegistries", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("clientRegistries.getRegistries.errorFetchingRegistries"),
    );
  }
};

/**
 * `POST /client-registries` — create a walk-in client (validated + sanitized upstream; ≥1 contact
 * and ≥1 address, exactly one principal/favorite each). All PII is encrypted at rest, like users.
 * The response is the same projected shape the list returns, so the order form can select the
 * fresh registry without refetching. When this person later becomes a PLATFORM user, the admin
 * deletes the registry (conditional NO-TRASH) — orders keep their snapshots, nothing to migrate.
 */
export const createClientRegistry = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as CreateClientRegistryRequestModel;
    const prismaClient = await getPrismaClient();
    const created = await prismaClient.clientRegistry.create({
      data: {
        nameKms: encryptKms(body.name),
        notesKms: body.notes !== undefined ? encryptKms(body.notes) : null,
        preferredPaymentMethodId: body.preferredPaymentMethodId ?? null,
        contacts: {
          create: body.contacts.map((contact) => ({
            contactTypeId: contact.contactTypeId,
            valueKms: encryptKms(contact.value),
            isPrincipal: contact.isPrincipal === true,
          })),
        },
        addresses: {
          create: body.addresses.map((address) => ({
            zoneId: address.zoneId ?? null,
            addressKms: encryptKms(address.address),
            instructionsKms:
              address.instructions !== undefined ? encryptKms(address.instructions) : null,
            // The pin is PII like the text it belongs to, so it is encrypted the same way — one
            // `"lat,lng"` payload in, one ciphertext out.
            coordsKms: address.coords !== undefined ? encryptKms(encodeCoords(address.coords)) : null,
            domicilePrice: address.domicilePrice ?? null,
            isFavorite: address.isFavorite === true,
          })),
        },
      },
      include: richRegistryInclude,
    });

    logger.info(
      i18next.t("clientRegistries.createRegistry.logs.registryCreated", { id: created.id }),
    );
    if (isDeployedEnvironment()) {
      logAudit({
        action: AuditAction.ADMIN_ACTION,
        ...(req.user && { userId: req.user.userId }),
        ...(req.ip && { ipAddress: req.ip }),
        resource: `ClientRegistry ID ${created.id}`,
        success: true,
        metadata: { operation: "CLIENT_REGISTRY_CREATED" },
      });
    }

    const response: ClientRegistryEnvelopeModel = {
      registry: projectClientRegistry(created),
    };
    sendOzariSuccess(
      res,
      HttpEnum.CREATED,
      i18next.t("clientRegistries.createRegistry.registryCreated"),
      response,
    );
  } catch (error) {
    logger.error(
      i18next.t("clientRegistries.createRegistry.logs.errorCreatingRegistry", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("clientRegistries.createRegistry.errorCreatingRegistry"),
    );
  }
};

/**
 * `PUT /client-registries/:id` — edit a walk-in client. **DECLARATIVE**, like the product and order
 * updates: the body is the registry's FINAL state, validated by the very same contract as create
 * (the identical middleware, so the two can never drift apart).
 *
 * Contacts and addresses are REPLACED rather than diffed, and that is safe precisely because of the
 * snapshot doctrine: an order records the contact/address TEXT it agreed, never a foreign key to
 * these rows. Nothing points at them, they are pure attribute rows (the NO-TRASH rule says such rows
 * hard-delete), and the client sends its whole list every time — so a diff would be machinery
 * without a beneficiary. Past orders are untouched by construction.
 *
 * What it deliberately does NOT do: reach into orders. Editing a client's address today must never
 * rewrite where an order that already happened was delivered.
 */
export const updateClientRegistry = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id < 1) {
      logger.warn(
        i18next.t("clientRegistries.updateRegistry.logs.registryNotFound", {
          id: req.params["id"],
        }),
      );
      sendOzariError(
        res,
        HttpEnum.NOT_FOUND,
        i18next.t("clientRegistries.updateRegistry.registryNotFound"),
      );
      return;
    }

    const body = req.body as CreateClientRegistryRequestModel;
    const prismaClient = await getPrismaClient();
    const existing = await prismaClient.clientRegistry.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
    if (!existing) {
      logger.warn(
        i18next.t("clientRegistries.updateRegistry.logs.registryNotFound", { id }),
      );
      sendOzariError(
        res,
        HttpEnum.NOT_FOUND,
        i18next.t("clientRegistries.updateRegistry.registryNotFound"),
      );
      return;
    }

    // ONE transaction: the old attribute rows leave and the new ones arrive together, so a reader
    // can never catch the client with half its contacts.
    const updated = await prismaClient.$transaction(async (tx) => {
      await tx.clientRegistryContact.deleteMany({ where: { clientRegistryId: id } });
      await tx.clientRegistryAddress.deleteMany({ where: { clientRegistryId: id } });
      return tx.clientRegistry.update({
        where: { id },
        data: {
          nameKms: encryptKms(body.name),
          notesKms: body.notes !== undefined ? encryptKms(body.notes) : null,
          preferredPaymentMethodId: body.preferredPaymentMethodId ?? null,
          contacts: {
            create: body.contacts.map((contact) => ({
              contactTypeId: contact.contactTypeId,
              valueKms: encryptKms(contact.value),
              isPrincipal: contact.isPrincipal === true,
            })),
          },
          addresses: {
            create: body.addresses.map((address) => ({
              zoneId: address.zoneId ?? null,
              addressKms: encryptKms(address.address),
              instructionsKms:
                address.instructions !== undefined ? encryptKms(address.instructions) : null,
              coordsKms:
                address.coords !== undefined ? encryptKms(encodeCoords(address.coords)) : null,
              domicilePrice: address.domicilePrice ?? null,
              isFavorite: address.isFavorite === true,
            })),
          },
        },
        include: richRegistryInclude,
      });
    });

    logger.info(
      i18next.t("clientRegistries.updateRegistry.logs.registryUpdated", { id }),
    );
    if (isDeployedEnvironment()) {
      logAudit({
        action: AuditAction.ADMIN_ACTION,
        ...(req.user && { userId: req.user.userId }),
        ...(req.ip && { ipAddress: req.ip }),
        resource: `ClientRegistry ID ${id}`,
        success: true,
        metadata: { operation: "CLIENT_REGISTRY_UPDATED" },
      });
    }

    const response: ClientRegistryEnvelopeModel = {
      registry: projectClientRegistry(updated),
    };
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("clientRegistries.updateRegistry.registryUpdated"),
      response,
    );
  } catch (error) {
    logger.error(
      i18next.t("clientRegistries.updateRegistry.logs.errorUpdatingRegistry", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("clientRegistries.updateRegistry.errorUpdatingRegistry"),
    );
  }
};
