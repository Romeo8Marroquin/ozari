import type { Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { AuditAction, logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { getStorage, StorageValidationError } from "@helpers/storage.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import {
  evidenceBoundsFor,
  getEvidenceBounds,
  getStatusCatalog,
  statusById,
  transitionKindFor,
} from "../lifecycle/lifecycle.service.js";
import type { ActorContextModel } from "../lifecycle/lifecycle.models.js";
import {
  loadOrderProjectionContext,
  projectOrderDetail,
  richOrderInclude,
  toLifecycleOrder,
} from "../orders.service.js";
import { type OrderDetailEnvelopeModel } from "../orders.models.js";
import {
  type AdvanceOrderRequestModel,
  type CreateOrderEvidenceUploadsRequestModel,
  type OrderEvidenceUploadsResponseModel,
} from "./advance.models.js";
import {
  AdvanceOrderError,
  assertEvidenceSatisfies,
  buildTransitionData,
} from "./advance.service.js";

/** The HTTP answer per failure kind — see {@link AdvanceOrderError}. */
const FAILURE_STATUS: Record<string, HttpEnum> = {
  notFound: HttpEnum.NOT_FOUND,
  forbidden: HttpEnum.FORBIDDEN,
  invalid: HttpEnum.CONFLICT,
  evidence: HttpEnum.UNPROCESSABLE_ENTITY,
};

/**
 * `POST /orders/:id/advance` — **the one mutating door of the order lifecycle**, for every actor and
 * every kind of move (forward, admin rewind, cancel). **Admin + Driver** (route guard); a driver may
 * only touch orders assigned to them, and only forward or cancel — the engine's permission matrix
 * decides, this controller just enforces the answer.
 *
 * Everything racy happens inside ONE `$transaction`:
 *  1. the order row is locked (`SELECT … FOR UPDATE`) and re-read, so two taps on the same order —
 *     the admin's phone and the driver's — serialize instead of both advancing it;
 *  2. the move is re-authorised UNDER the lock (`transitionKindFor`): a stale client that offered an
 *     action which is no longer legal gets a clean **409**, never a silent double-advance;
 *  3. the target's evidence requirement is checked against its RESOLVED bounds (**422** when unmet)
 *     and the pre-uploaded R2 keys become `service_evidence` rows for the phase being entered;
 *  4. the append-only `service_status_history` row records who moved it, from where, to where;
 *  5. the order's status + tracked actuals are written from the FLAGS (`buildTransitionData`).
 *
 * Availability needs no write at all: rental holds are DERIVED from the status' `inventoryHold`, so
 * step 5 is what returns (or keeps) the units — there is no counter to drift.
 *
 * The response is the same `{ order }` envelope as `GET /orders/:id`, so the agenda cache absorbs it
 * without translation and the ticket's next action re-renders from the new `actions`.
 */
export const advanceOrder = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as AdvanceOrderRequestModel;
    const id = Number(req.params["id"]);
    /* v8 ignore next 2 -- the route guarantees an authenticated Admin/Driver; defensive fallbacks */
    const actor: ActorContextModel = {
      userId: req.user?.userId ?? 0,
      role: req.user?.userRole ?? RolesEnum.Client,
    };
    if (!Number.isInteger(id) || id < 1) {
      throw new AdvanceOrderError("notFound");
    }

    const [catalog, globalBounds] = await Promise.all([
      getStatusCatalog(),
      getEvidenceBounds(),
    ]);
    const toStatus = statusById(catalog, body.toStatusId);
    if (!toStatus) {
      throw new AdvanceOrderError("invalid");
    }

    const prismaClient = await getPrismaClient();
    const updated = await prismaClient.$transaction(async (tx) => {
      // Serialize concurrent taps on THIS order (see the doc above).
      await tx.$queryRaw`SELECT id FROM services WHERE id = ${id} FOR UPDATE`;
      const order = await tx.service.findFirst({
        where: { id, isActive: true },
        include: richOrderInclude,
      });
      if (!order) {
        throw new AdvanceOrderError("notFound");
      }

      const lifecycleOrder = toLifecycleOrder(order);
      const kind = transitionKindFor(catalog, lifecycleOrder, toStatus, actor);
      if (!kind) {
        // Re-ask as an ADMIN: if the move is legal for them, this actor simply isn't allowed it
        // (403); if nobody could make it from here, the request is stale or wrong (409).
        const legalForAdmin = transitionKindFor(catalog, lifecycleOrder, toStatus, {
          userId: actor.userId,
          role: RolesEnum.Admin,
        });
        throw new AdvanceOrderError(legalForAdmin ? "forbidden" : "invalid", {
          from: order.serviceStatusId,
          to: toStatus.id,
        });
      }

      assertEvidenceSatisfies(
        toStatus,
        kind,
        evidenceBoundsFor(toStatus, globalBounds),
        body.evidenceKeys,
      );

      const storage = body.evidenceKeys.length > 0 ? getStorage() : null;
      const now = new Date();
      await tx.service.update({
        where: { id },
        data: {
          ...buildTransitionData({
            catalog,
            order: lifecycleOrder,
            from: statusById(catalog, order.serviceStatusId),
            to: toStatus,
            kind,
            now,
            ...(body.reason !== undefined && { reason: body.reason }),
          }),
          // The photos document the phase being ENTERED (`serviceStatusId` = that step), exactly as
          // the evidence model intends. The URL is derived from the key server-side — a client-sent
          // URL is never trusted.
          ...(storage
            ? {
                evidences: {
                  create: body.evidenceKeys.map((key) => ({
                    serviceStatusId: toStatus.id,
                    r2Key: key,
                    url: storage.getPublicUrl(key),
                  })),
                },
              }
            : {}),
          statusHistory: {
            create: {
              fromStatusId: order.serviceStatusId,
              toStatusId: toStatus.id,
              byUserId: actor.userId,
            },
          },
        },
      });

      return tx.service.findUniqueOrThrow({
        where: { id },
        include: richOrderInclude,
      });
    });

    logger.info(
      i18next.t("orders.advance.logs.orderAdvanced", {
        id,
        toStatusId: toStatus.id,
      }),
    );
    if (isDeployedEnvironment()) {
      logAudit({
        action: AuditAction.ADMIN_ACTION,
        ...(req.user && { userId: req.user.userId }),
        ...(req.ip && { ipAddress: req.ip }),
        resource: `Order ID ${id}`,
        success: true,
        metadata: { operation: "ORDER_ADVANCED", toStatusId: toStatus.id },
      });
    }
    // Post-commit hook point (best-effort, never fails the request): per-status notifications and
    // auto-assign policies plug in HERE — see EPIC-2-ORDER-LIFECYCLE §7.

    const response: OrderDetailEnvelopeModel = {
      order: projectOrderDetail(
        updated,
        await loadOrderProjectionContext(actor),
      ),
    };
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("orders.advance.orderAdvanced"),
      response,
    );
  } catch (error) {
    if (error instanceof AdvanceOrderError) {
      logger.warn(
        i18next.t(`orders.advance.logs.${error.kind}`, {
          id: req.params["id"],
          detail: JSON.stringify(error.detail ?? {}),
        }),
      );
      sendOzariError(
        res,
        FAILURE_STATUS[error.kind] ?? HttpEnum.CONFLICT,
        i18next.t(`orders.advance.${error.kind}`),
      );
      return;
    }
    logger.error(i18next.t("orders.advance.logs.errorAdvancing", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.advance.errorAdvancing"),
    );
  }
};

/**
 * `POST /orders/evidence/upload-url` — mints presigned R2 PUTs for tracking photos (**Admin +
 * Driver**), the exact pattern products uses for its gallery: the browser uploads straight to R2 (no
 * image bytes through Cloud Run, no 10 kB body cap problem) and then hands the KEYS to `advance`,
 * which derives the public URL itself. Keys live under their own `orders/evidence` prefix.
 */
export const createOrderEvidenceUploads = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const { files } = req.body as CreateOrderEvidenceUploadsRequestModel;
    const storage = getStorage();
    const uploads = await Promise.all(
      files.map((file) =>
        storage.createUpload({
          kind: "orderEvidence",
          contentType: file.contentType,
          contentLength: file.contentLength,
        }),
      ),
    );

    logger.info(
      i18next.t("orders.evidenceUploads.logs.uploadsCreated", {
        count: uploads.length,
      }),
    );
    const response: OrderEvidenceUploadsResponseModel = { uploads };
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("orders.evidenceUploads.uploadsCreated"),
      response,
    );
  } catch (error) {
    if (error instanceof StorageValidationError) {
      logger.warn(
        i18next.t("orders.evidenceUploads.logs.uploadPolicyViolation", { error }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("orders.evidenceUploads.validators.invalidFiles"),
      );
      return;
    }
    logger.error(
      i18next.t("orders.evidenceUploads.logs.errorCreatingUploads", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.evidenceUploads.errorCreatingUploads"),
    );
  }
};
