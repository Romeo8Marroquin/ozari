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
import { syncOrderCalendars } from "../../calendar/calendar.sync.js";
import {
  getEvidenceBounds,
  getStatusCatalog,
  holdingStatusIds,
  resolveStatusPath,
  statusById,
} from "../lifecycle/lifecycle.service.js";
import type { ActorContextModel } from "../lifecycle/lifecycle.models.js";
import {
  holdsSaleStock,
  loadOrderProjectionContext,
  loadOrderTimingPreferences,
  OrderStockConflictError,
  projectOrderDetail,
  reclaimOrderStock,
  releaseSaleStock,
  richOrderInclude,
  toLifecycleOrder,
} from "../orders.service.js";
import { sendLogisticsConflict } from "../orders.controller.js";
import {
  assertDriverAvailable,
  upcomingLogisticsEvents,
} from "../logistics/logistics.service.js";
import { type OrderDetailEnvelopeModel } from "../orders.models.js";
import {
  type AdvanceOrderRequestModel,
  type CreateOrderEvidenceUploadsRequestModel,
  type OrderEvidenceUploadsResponseModel,
} from "./advance.models.js";
import { AdvanceOrderError, planStatusPath } from "./advance.service.js";

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
/* eslint-disable complexity, no-await-in-loop, sonarjs/cognitive-complexity -- one linear
   transaction script (lock → re-authorise → plan → walk the steps IN ORDER, moving stock at the two
   points it moves); the sequential awaits are the point, and splitting it would scatter an
   atomicity story that can never run outside the transaction. */
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
    // Which statuses hold rental units — needed only when an order comes back from a cancellation
    // and has to re-check the fleet it would take again.
    const holding = holdingStatusIds(catalog);
    const toStatus = statusById(catalog, body.toStatusId);
    if (!toStatus) {
      throw new AdvanceOrderError("invalid");
    }

    /** R2 keys freed by backward steps — deleted only AFTER the transaction commits. */
    const purgedKeys: string[] = [];
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
      // The PATH, not a single move: one step for the ordinary tap, several for an admin jump, one
      // for reopening a cancelled order. Every entry is a move the permission matrix already allows.
      const path = resolveStatusPath(catalog, lifecycleOrder, toStatus, actor);
      if (!path) {
        // Re-ask as an ADMIN: if the move is legal for them, this actor simply isn't allowed it
        // (403); if nobody could make it from here, the request is stale or wrong (409).
        const legalForAdmin = resolveStatusPath(catalog, lifecycleOrder, toStatus, {
          userId: actor.userId,
          role: RolesEnum.Admin,
        });
        throw new AdvanceOrderError(legalForAdmin ? "forbidden" : "invalid", {
          from: order.serviceStatusId,
          to: toStatus.id,
        });
      }

      const now = new Date();
      // Planned in full BEFORE anything is written: a jump whose middle step lacks its photos is
      // rejected here, so the order never lands half-documented.
      const steps = planStatusPath({
        catalog,
        order: lifecycleOrder,
        path,
        evidenceByStatus: new Map(
          body.evidence.map((entry) => [entry.statusId, entry.keys]),
        ),
        bounds: globalBounds,
        now,
        ...(body.reason !== undefined && { reason: body.reason }),
      });

      // ── The driver's day, for the moves that GIVE WORK BACK ────────────────────────────────────
      // Reopening a cancelled order, or rewinding out of a step that had already been confirmed,
      // makes an event PENDING again — so the order starts occupying its driver at a moment it had
      // released. If that slot was promised to somebody else meanwhile, saying so now is the whole
      // point: the alternative is a driver double-booked by a tap that looked like paperwork.
      //
      // Checked ONCE, against the state the whole walk lands on (a jump can rewind several steps),
      // and BEFORE any write — like every other refusal in this module. Forward moves only ever
      // stamp actuals, which can never add occupancy, so they are skipped entirely.
      //
      // Only UPCOMING events count (`upcomingLogisticsEvents`): rewinding an order whose dates have
      // passed is pure record-keeping and must never be blocked by a clash nobody can now fix.
      const givesWorkBack = steps.some(
        (step) => step.kind === "reopen" || step.kind === "backward",
      );
      if (givesWorkBack && order.assignedUserId !== null) {
        const after = steps.reduce(
          (state, step) => ({ ...state, ...step.data }),
          {
            deliveredAt: order.deliveredAt,
            collectedAt: order.collectedAt,
            cancelledAt: order.cancelledAt,
          } as Record<string, unknown>,
        );
        const { spacingMinutes } = await loadOrderTimingPreferences(tx);
        await assertDriverAvailable(
          tx,
          upcomingLogisticsEvents(
            {
              deliveryAt: order.deliveryAt,
              pickupAt: order.pickupAt,
              deliveredAt: after["deliveredAt"] as Date | null,
              collectedAt: after["collectedAt"] as Date | null,
              cancelledAt: after["cancelledAt"] as Date | null,
            },
            now,
          ),
          {
            gapMinutes: spacingMinutes,
            driverId: order.assignedUserId,
            excludeServiceId: id,
          },
        );
      }

      const storage = getStorage();
      const stockLines = order.serviceDetails.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        isRental: line.isRental,
      }));
      let fromStatusId = order.serviceStatusId;
      for (const step of steps) {
        // ── Inventory, at the only two points where it actually moves ──────────────────────────
        // Rentals need nothing: their hold is DERIVED from the status, so cancelling frees them and
        // reopening re-takes them the moment the row changes. Sale units are a real decrement made
        // at creation, so they must be handed back when the order stops being real and taken again
        // — with a fresh availability check — if it comes back. Both are gated on whether the order
        // was still HOLDING them: once delivered, the goods are with the client and no state change
        // here can move them.
        if (step.kind === "disruptive" && holdsSaleStock(order)) {
          await releaseSaleStock(tx, stockLines);
        }
        // Symmetrically, only re-take what the cancellation actually gave back — re-checked against
        // the fleet under the SAME rule a create uses, washing period included.
        if (step.kind === "reopen" && order.deliveredAt === null) {
          const { turnaroundMinutes } = await loadOrderTimingPreferences(tx);
          await reclaimOrderStock(
            tx,
            {
              id,
              serviceStart: order.serviceStart,
              serviceEnd: order.serviceEnd,
              lines: stockLines,
            },
            holding,
            turnaroundMinutes,
          );
        }
        // Undoing a step destroys the photos that documented it — rows now, objects post-commit.
        if (step.purgeStatusId !== null) {
          const doomed = await tx.serviceEvidence.findMany({
            where: { serviceId: id, serviceStatusId: step.purgeStatusId },
            select: { r2Key: true },
          });
          purgedKeys.push(...doomed.map((row) => row.r2Key));
          await tx.serviceEvidence.deleteMany({
            where: { serviceId: id, serviceStatusId: step.purgeStatusId },
          });
        }
        await tx.service.update({
          where: { id },
          data: {
            ...step.data,
            // The photos document the phase being ENTERED (`serviceStatusId` = that step), exactly
            // as the evidence model intends. The URL is derived from the key server-side — a
            // client-sent URL is never trusted.
            ...(step.evidenceKeys.length > 0
              ? {
                  evidences: {
                    create: step.evidenceKeys.map((key) => ({
                      serviceStatusId: step.to.id,
                      r2Key: key,
                      url: storage.getPublicUrl(key),
                    })),
                  },
                }
              : {}),
            // One history row PER step, even in a jump: the trail records the walk that was taken.
            statusHistory: {
              create: {
                fromStatusId,
                toStatusId: step.to.id,
                byUserId: actor.userId,
              },
            },
          },
        });
        fromStatusId = step.to.id;
      }

      return tx.service.findUniqueOrThrow({
        where: { id },
        include: richOrderInclude,
      });
    });

    // Post-commit, best-effort: the photos of undone steps. A failure here leaves a sweepable
    // orphan object, never a row pointing at a deleted file (the products delete policy).
    if (purgedKeys.length > 0) {
      try {
        await getStorage().deleteObjects(purgedKeys);
      } catch (error) {
        logger.warn(
          i18next.t("orders.advance.logs.evidenceCleanupFailed", { error }),
        );
      }
    }

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
    //
    // The connected calendars are the first tenant. A move is exactly what changes what belongs in
    // one: confirming a delivery retires that entry (it is work already done, and being reminded
    // about it tomorrow would be absurd), a cancellation retires both, and a REWIND clears the
    // actual and brings the entry back — all of it derived, because `calendarEntriesFor` reads the
    // same actuals the logistics pad does rather than a status id.
    await syncOrderCalendars(id);

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
    // Giving work back to a driver whose day has since filled up — the SAME payload shape create and
    // edit answer with (`data.driverConflict` / `data.selfOverlap`), through the same function, so
    // the three doors can never describe the refusal differently.
    if (sendLogisticsConflict(res, "advance", error)) {
      return;
    }
    if (error instanceof OrderStockConflictError) {
      // Reopening a cancelled order whose goods have since been promised elsewhere: the same
      // structured 409 the create flow answers, so the UI can name each line and its real count.
      logger.warn(
        i18next.t("orders.advance.logs.stockConflict", {
          conflicts: JSON.stringify(error.conflicts),
        }),
      );
      sendOzariError(
        res,
        HttpEnum.CONFLICT,
        i18next.t("orders.advance.stockConflict"),
        undefined,
        { conflicts: error.conflicts },
      );
      return;
    }
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
