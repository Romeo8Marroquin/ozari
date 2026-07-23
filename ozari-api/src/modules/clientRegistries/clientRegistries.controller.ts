import type { Response } from "express";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { encryptKms } from "@helpers/encryption.js";
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
