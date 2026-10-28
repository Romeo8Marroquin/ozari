import type { Response } from "express";
import type { Prisma } from "@prisma/client";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { AuditAction, logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import {
  computeDepositTotal,
  loadOrderProjectionContext,
  projectOrderDetail,
  richOrderInclude,
  type RichOrder,
} from "../orders.service.js";
import type {
  DepositCollectionRequestModel,
  OrderDetailEnvelopeModel,
} from "../orders.models.js";
import { applyDepositCollection } from "./depositCollection.service.js";

/** The order facts a collection write is decided on, read under the row lock. */
const collectionStateSelect = {
  cancelledAt: true,
  depositReceivedAt: true,
  depositWaivedAt: true,
  depositWaivedReason: true,
  serviceDetails: {
    where: { isActive: true },
    select: { isRental: true, quantity: true, securityDeposit: true, replacementPrice: true },
  },
} satisfies Prisma.ServiceSelect;

/** Projects the written order into the shared `{ order }` envelope and answers with it. */
const respondWithOrder = async (
  req: CustomRequest,
  res: Response,
  order: RichOrder,
  messageKey: string,
): Promise<void> => {
  const context = await loadOrderProjectionContext({
    userId: req.user?.userId ?? 0,
    role: req.user?.userRole ?? RolesEnum.Admin,
  });
  const response: OrderDetailEnvelopeModel = { order: projectOrderDetail(order, context) };
  sendOzariSuccess(res, HttpEnum.OK, i18next.t(messageKey), response);
};

const auditCollection = (req: CustomRequest, id: number, operation: string): void => {
  if (isDeployedEnvironment()) {
    logAudit({
      action: AuditAction.ADMIN_ACTION,
      ...(req.user && { userId: req.user.userId }),
      ...(req.ip && { ipAddress: req.ip }),
      resource: `Order ID ${id}`,
      success: true,
      metadata: { operation },
    });
  }
};

/** The refusals both doors share, as their HTTP answers (`ok` is handled by each door). */
const sendRefusal = (res: Response, id: number, kind: string): void => {
  if (kind === "missing") {
    sendOzariError(res, HttpEnum.NOT_FOUND, i18next.t("orders.depositCollection.notFound"));
    return;
  }
  logger.warn(i18next.t(`orders.depositCollection.logs.${kind}`, { id }));
  sendOzariError(res, HttpEnum.CONFLICT, i18next.t(`orders.depositCollection.${kind}`));
};

/**
 * `PUT /orders/:id/deposit-collection` — records whether the order's security deposit was actually
 * COLLECTED (EPIC-2-ORDERS §12): `received: true` stamps `depositReceivedAt`; `received: false`
 * WAIVES it (`depositWaivedAt` + the required reason) — the deposit was not received. The two are
 * mutually exclusive. Only a RECEIVED deposit is money we have (`heldDeposit`, owner 2026-10-28):
 * while PENDING or WAIVED the damage report refunds nothing and owes every claim (retention and
 * replacements) on top.
 *
 * Normally asked at the delivery step (the advance's `depositCollection`); this door records,
 * corrects or clears it any time the order is not cancelled — BEFORE or AFTER the damage report (a
 * deposit received late is recorded here; the report's money is computed live, so it follows).
 * **Declarative**: re-sending the same answer keeps the original timestamp and appends nothing.
 *
 * `409 notApplicable` when the order is cancelled or carries no deposit.
 */
export const recordDepositCollection = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  const id = Number(req.params["id"]);
  try {
    const body = req.body as DepositCollectionRequestModel;
    const prismaClient = await getPrismaClient();

    const result = await prismaClient.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM services WHERE id = ${id} AND is_active = true FOR UPDATE
      `;
      if (!current) {
        return { kind: "missing" as const };
      }
      const order = await tx.service.findUniqueOrThrow({
        where: { id },
        select: collectionStateSelect,
      });
      const depositTotal = computeDepositTotal(order.serviceDetails);
      if (order.cancelledAt !== null || depositTotal <= 0) {
        return { kind: "notApplicable" as const };
      }
      await applyDepositCollection(tx, {
        serviceId: id,
        current: order,
        input: body,
        depositTotal,
        byUserId: req.user?.userId ?? 0,
        now: new Date(),
      });
      return {
        kind: "ok" as const,
        order: await tx.service.findUniqueOrThrow({ where: { id }, include: richOrderInclude }),
      };
    });

    if (result.kind !== "ok") {
      sendRefusal(res, id, result.kind);
      return;
    }
    logger.info(i18next.t("orders.depositCollection.logs.recorded", { id }));
    auditCollection(req, id, "ORDER_DEPOSIT_COLLECTION_RECORDED");
    await respondWithOrder(req, res, result.order, "orders.depositCollection.recorded");
  } catch (error) {
    logger.error(i18next.t("orders.depositCollection.logs.error"), { error });
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.depositCollection.errorRecording"),
    );
  }
};

/**
 * `DELETE /orders/:id/deposit-collection` — back to PENDING: both stamps and the reason go (a hard
 * clear of our own record; it moves no money) and a `COLLECTION_CLEARED` trail row is appended.
 * Allowed after a damage report too (the report's money recomputes live — clearing a RECEIVED
 * collection turns its refund into a balance owed). `409 notRecorded` when nothing is recorded;
 * `409 notApplicable` on a cancelled order (the same `canRecord` rule the detail projects).
 */
export const clearDepositCollection = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  const id = Number(req.params["id"]);
  try {
    const prismaClient = await getPrismaClient();

    const result = await prismaClient.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM services WHERE id = ${id} AND is_active = true FOR UPDATE
      `;
      if (!current) {
        return { kind: "missing" as const };
      }
      const order = await tx.service.findUniqueOrThrow({
        where: { id },
        select: collectionStateSelect,
      });
      if (order.depositReceivedAt === null && order.depositWaivedAt === null) {
        return { kind: "notRecorded" as const };
      }
      if (order.cancelledAt !== null) {
        return { kind: "notApplicable" as const };
      }
      await tx.service.update({
        where: { id },
        data: { depositReceivedAt: null, depositWaivedAt: null, depositWaivedReason: null },
      });
      await tx.serviceDepositHistory.create({
        data: {
          serviceId: id,
          kind: "COLLECTION_CLEARED",
          depositTotal: computeDepositTotal(order.serviceDetails),
          byUserId: req.user?.userId ?? 0,
        },
      });
      return {
        kind: "ok" as const,
        order: await tx.service.findUniqueOrThrow({ where: { id }, include: richOrderInclude }),
      };
    });

    if (result.kind !== "ok") {
      sendRefusal(res, id, result.kind);
      return;
    }
    logger.info(i18next.t("orders.depositCollection.logs.cleared", { id }));
    auditCollection(req, id, "ORDER_DEPOSIT_COLLECTION_CLEARED");
    await respondWithOrder(req, res, result.order, "orders.depositCollection.cleared");
  } catch (error) {
    logger.error(i18next.t("orders.depositCollection.logs.clearError"), { error });
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.depositCollection.errorClearing"),
    );
  }
};
