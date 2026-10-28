import type { Response } from "express";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import {
  canRecordSettlement,
  computeDepositTotal,
  computeSettlementMoney,
  heldDeposit,
  isSettleableLine,
  loadOrderProjectionContext,
  projectOrderDetail,
  richOrderInclude,
  type RichOrder,
} from "../orders.service.js";
import type {
  OrderDetailEnvelopeModel,
  SettleOrderRequestModel,
} from "../orders.models.js";

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

const auditSettlement = (req: CustomRequest, id: number, operation: string): void => {
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

/**
 * `PUT /orders/:id/settlement` — records (or corrects) what happens to the order's SECURITY DEPOSIT
 * once the goods are back: refund it whole, retain part of it for partial damage (with a reason),
 * and bill units that came back broken or never came back at their replacement value
 * (EPIC-2-ORDERS §12).
 *
 * **Its own door, like payment — never a pipeline step.** The settlement is a judgement about money
 * that can happen the day of the pickup or a week later (once the owner has inspected and washed
 * the goods); forcing it into the lifecycle would block the "listo" press on a decision that has
 * nothing to do with whether the units are back in the fleet.
 *
 * **Declarative**: the body is the settlement's FINAL state. A line missing from `damages` has no
 * damage; re-sending corrects a settlement without re-stamping `depositSettledAt` (the moment it was
 * FIRST settled is the fact worth keeping). Every amount is derived from the line snapshots — the
 * admin never types a replacement price.
 *
 * Allowed once the order was DELIVERED and while it is not cancelled, and only when it has a line
 * that can carry a deposit or a damage (`409` otherwise — the screen is stale or the order never
 * qualified). A damage on a line that cannot carry one, or a retention above the deposit, is a
 * `400` about the request. Stock is deliberately NOT touched: a broken chair is normally replaced
 * with the client's money, so the fleet the business intends to own is unchanged; a unit that will
 * not be replaced is an edit of the product's quantity.
 *
 * **The deposit counted is the HELD one** (`heldDeposit`, owner 2026-10-28): the deposit only when
 * its collection is RECEIVED, 0 while PENDING or WAIVED — so an order whose deposit never reached us
 * refunds nothing and owes every claim on top. The retention is capped by the NOMINAL deposit
 * (`computeDepositTotal`), not the held one: the damaged items are charged "that part of the
 * deposit" even when it was not received. Recording a report NEVER changes the collection status —
 * that is its own door, editable before or after the report (the money recomputes live).
 */
export const settleOrder = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  const id = Number(req.params["id"]);
  try {
    const body = req.body as SettleOrderRequestModel;
    const prismaClient = await getPrismaClient();

    const result = await prismaClient.$transaction(async (tx) => {
      // Locked, like every other order mutation: an edit or a second settle must not interleave.
      const [current] = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM services WHERE id = ${id} AND is_active = true FOR UPDATE
      `;
      if (!current) {
        return { kind: "missing" as const };
      }
      const order = await tx.service.findUniqueOrThrow({
        where: { id },
        select: {
          deliveredAt: true,
          cancelledAt: true,
          depositSettledAt: true,
          depositReceivedAt: true,
          serviceDetails: {
            where: { isActive: true },
            select: {
              id: true,
              isRental: true,
              quantity: true,
              securityDeposit: true,
              replacementPrice: true,
              damagedQuantity: true,
            },
          },
        },
      });
      if (!canRecordSettlement(order) || !order.serviceDetails.some(isSettleableLine)) {
        return { kind: "notSettleable" as const };
      }

      const lineById = new Map(order.serviceDetails.map((line) => [line.id, line]));
      const damageable = body.damages.every((damage) => {
        const line = lineById.get(damage.lineId);
        return (
          line !== undefined &&
          line.isRental &&
          line.replacementPrice !== null &&
          damage.quantity <= line.quantity
        );
      });
      if (!damageable) {
        return { kind: "invalidDamage" as const };
      }
      // The retention is capped by the NOMINAL deposit (it is charged even when the deposit was not
      // received); every money figure below counts the HELD one (0 unless RECEIVED).
      if (body.retainedAmount > computeDepositTotal(order.serviceDetails)) {
        return { kind: "retainedAboveDeposit" as const };
      }
      const held = heldDeposit(order);

      const now = new Date();

      // Every line whose damage CHANGES — newly damaged, corrected, or no longer damaged.
      const damageByLine = new Map(body.damages.map((damage) => [damage.lineId, damage]));
      await Promise.all(
        order.serviceDetails
          .filter((line) => line.damagedQuantity > 0 || damageByLine.has(line.id))
          .map((line) => {
            const damage = damageByLine.get(line.id);
            return tx.serviceDetail.update({
              where: { id: line.id },
              data: {
                damagedQuantity: damage?.quantity ?? 0,
                damageNote: damage?.note ?? null,
              },
            });
          }),
      );
      await tx.service.update({
        where: { id },
        data: {
          depositSettledAt: order.depositSettledAt ?? now,
          depositRetainedAmount: body.retainedAmount,
          depositRetainedReason: body.retainedReason ?? null,
        },
      });
      // The trail row: the outcome AS RECORDED NOW, so the order's history stays true after a later
      // correction or undo. Same formula as the projection — damages at the lines' replacement value.
      // Walked over the LINES (every damaged one was validated above to carry a replacement value).
      const damagesTotal = order.serviceDetails.reduce(
        (sum, line) =>
          sum +
          Number(line.replacementPrice ?? 0) * (damageByLine.get(line.id)?.quantity ?? 0),
        0,
      );
      const money = computeSettlementMoney(held, body.retainedAmount, damagesTotal);
      await tx.serviceDepositHistory.create({
        data: {
          serviceId: id,
          kind: order.depositSettledAt === null ? "RECORDED" : "CORRECTED",
          depositTotal: held,
          claimsTotal: money.claimsTotal,
          refundAmount: money.refundAmount,
          balanceDue: money.balanceDue,
          byUserId: req.user?.userId ?? 0,
        },
      });
      return {
        kind: "ok" as const,
        order: await tx.service.findUniqueOrThrow({ where: { id }, include: richOrderInclude }),
      };
    });

    if (result.kind === "missing") {
      sendOzariError(res, HttpEnum.NOT_FOUND, i18next.t("orders.settlement.notFound"));
      return;
    }
    if (result.kind === "notSettleable") {
      logger.warn(i18next.t("orders.settlement.logs.notSettleable", { id }));
      sendOzariError(res, HttpEnum.CONFLICT, i18next.t("orders.settlement.notSettleable"));
      return;
    }
    if (result.kind !== "ok") {
      // `invalidDamage` | `retainedAboveDeposit` — both a 400 about what was asked.
      logger.warn(i18next.t(`orders.settlement.logs.${result.kind}`, { id }));
      sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t(`orders.settlement.${result.kind}`));
      return;
    }

    logger.info(i18next.t("orders.settlement.logs.settled", { id }));
    auditSettlement(req, id, "ORDER_DEPOSIT_SETTLED");
    await respondWithOrder(req, res, result.order, "orders.settlement.settled");
  } catch (error) {
    logger.error(i18next.t("orders.settlement.logs.error"), { error });
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.settlement.errorSettling"),
    );
  }
};

/**
 * `DELETE /orders/:id/settlement` — DELETES a recorded settlement: the retention, its reason and
 * every line's damage go, leaving the deposit "not settled yet" exactly as before. A hard delete,
 * like the payment's undo (NO-TRASH: nothing references a settlement). It is allowed whatever the
 * order's state — even one cancelled or rewound since — because it only clears our own record. It
 * moves no money: if a refund was already handed over, that happened in the real world.
 *
 * An order with no settlement answers `409` (a stale screen), the mirror of the payment's undo.
 */
export const undoOrderSettlement = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  const id = Number(req.params["id"]);
  try {
    const prismaClient = await getPrismaClient();

    const result = await prismaClient.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<{ id: number; deposit_settled_at: Date | null }[]>`
        SELECT id, deposit_settled_at FROM services WHERE id = ${id} AND is_active = true FOR UPDATE
      `;
      if (!current) {
        return { kind: "missing" as const };
      }
      if (current.deposit_settled_at === null) {
        return { kind: "notSettled" as const };
      }
      await tx.serviceDetail.updateMany({
        where: { serviceId: id, damagedQuantity: { gt: 0 } },
        data: { damagedQuantity: 0, damageNote: null },
      });
      await tx.service.update({
        where: { id },
        data: {
          depositSettledAt: null,
          depositRetainedAmount: null,
          depositRetainedReason: null,
        },
      });
      await tx.serviceDepositHistory.create({
        data: { serviceId: id, kind: "UNDONE", byUserId: req.user?.userId ?? 0 },
      });
      return {
        kind: "ok" as const,
        order: await tx.service.findUniqueOrThrow({ where: { id }, include: richOrderInclude }),
      };
    });

    if (result.kind === "missing") {
      sendOzariError(res, HttpEnum.NOT_FOUND, i18next.t("orders.settlement.notFound"));
      return;
    }
    if (result.kind === "notSettled") {
      logger.warn(i18next.t("orders.settlement.logs.notSettled", { id }));
      sendOzariError(res, HttpEnum.CONFLICT, i18next.t("orders.settlement.notSettled"));
      return;
    }

    logger.info(i18next.t("orders.settlement.logs.undone", { id }));
    auditSettlement(req, id, "ORDER_DEPOSIT_SETTLEMENT_UNDONE");
    await respondWithOrder(req, res, result.order, "orders.settlement.undone");
  } catch (error) {
    logger.error(i18next.t("orders.settlement.logs.undoError"), { error });
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.settlement.errorUndoing"),
    );
  }
};
