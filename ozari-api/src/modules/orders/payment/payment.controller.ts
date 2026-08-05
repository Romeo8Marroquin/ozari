import type { Response } from "express";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { PaymentStatusEnum } from "@models/enums/paymentStatusEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import {
  loadOrderProjectionContext,
  projectOrderDetail,
  richOrderInclude,
} from "../orders.service.js";
import type { OrderDetailEnvelopeModel } from "../orders.models.js";

/**
 * `POST /orders/:id/payment` — records that an order was PAID.
 *
 * **Deliberately its own door, not a step of the lifecycle.** Payment and fulfilment are independent
 * axes: a client can pay a deposit days before delivery, hand over cash at the door, or settle a
 * week after collection. Modelling it as a pipeline status would force an ordering that the business
 * does not have, and would make "delivered but unpaid" unrepresentable — which is precisely the
 * state the admin most needs to see.
 *
 * The write is small and total: stamp `paidAt`, move `paymentStatusId` to PAID, and record HOW it
 * was paid when the caller says. It never touches the service status, the actuals or the stock.
 *
 * Idempotence is a **409, not a silent success**: an order that is already paid means the admin is
 * looking at a stale screen, and quietly re-stamping `paidAt` would overwrite the real payment date
 * with the moment of the second tap. Same stance as the advance's stale-move conflict.
 */
export const payOrder = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  const id = Number(req.params["id"]);
  try {
    const prismaClient = await getPrismaClient();
    const body = req.body as { paymentMethodId?: number };

    const updated = await prismaClient.$transaction(async (tx) => {
      // Locked read, like every other order mutation: two admins tapping at once must not both
      // succeed with different timestamps.
      const [current] = await tx.$queryRaw<{ id: number; paid_at: Date | null }[]>`
        SELECT id, paid_at FROM services WHERE id = ${id} AND is_active = true FOR UPDATE
      `;
      if (!current) {
        return { kind: "missing" as const };
      }
      if (current.paid_at !== null) {
        return { kind: "already" as const };
      }
      // A method is optional (cash at the door often has none recorded), but a supplied one must
      // exist and be published — otherwise the order would carry a dangling snapshot.
      if (body.paymentMethodId !== undefined) {
        const method = await tx.paymentMethod.findFirst({
          where: { id: body.paymentMethodId, isActive: true },
          select: { id: true },
        });
        if (!method) {
          return { kind: "badMethod" as const };
        }
      }
      await tx.service.update({
        where: { id },
        data: {
          paidAt: new Date(),
          paymentStatusId: PaymentStatusEnum.PAID,
          ...(body.paymentMethodId !== undefined && {
            paymentMethodId: body.paymentMethodId,
          }),
        },
      });
      return {
        kind: "ok" as const,
        order: await tx.service.findUniqueOrThrow({
          where: { id },
          include: richOrderInclude,
        }),
      };
    });

    if (updated.kind === "missing") {
      sendOzariError(res, HttpEnum.NOT_FOUND, i18next.t("orders.payOrder.notFound"));
      return;
    }
    if (updated.kind === "already") {
      logger.warn(i18next.t("orders.payOrder.logs.alreadyPaid", { id }));
      sendOzariError(res, HttpEnum.CONFLICT, i18next.t("orders.payOrder.alreadyPaid"));
      return;
    }
    if (updated.kind === "badMethod") {
      sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t("orders.payOrder.invalidMethod"));
      return;
    }

    const context = await loadOrderProjectionContext({
      userId: req.user?.userId ?? 0,
      role: req.user?.userRole ?? RolesEnum.Admin,
    });
    const response: OrderDetailEnvelopeModel = {
      order: projectOrderDetail(updated.order, context),
    };

    logger.info(i18next.t("orders.payOrder.logs.paid", { id }));
    if (isDeployedEnvironment()) {
      logAudit({
        action: AuditAction.ADMIN_ACTION,
        ...(req.user && { userId: req.user.userId }),
        ...(req.ip && { ipAddress: req.ip }),
        resource: `Order ID ${id}`,
        success: true,
        metadata: { operation: "ORDER_PAID" },
      });
    }
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("orders.payOrder.paid"), response);
  } catch (error) {
    logger.error(i18next.t("orders.payOrder.logs.error"), { error });
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("orders.payOrder.errorPaying"),
    );
  }
};
