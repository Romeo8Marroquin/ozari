import type { Prisma } from "@prisma/client";
import type { DepositCollectionRequestModel } from "../orders.models.js";
import { pendingDepositToCollect } from "../orders.service.js";

/**
 * The deposit's COLLECTION write (EPIC-2-ORDERS §12) — ONE implementation shared by the three doors
 * that record it: `PUT /orders/:id/deposit-collection`, the delivery advance (`depositCollection`),
 * and a damage report recorded on a still-pending collection (which confirms the deposit was in
 * hand). Each door decides WHETHER it may write; this decides WHAT changes and leaves the trail row.
 */

/** The collection columns as they stand under the row lock. */
export interface DepositCollectionStateModel {
  depositReceivedAt: Date | null;
  depositWaivedAt: Date | null;
  depositWaivedReason: string | null;
}

/** What a collection write changes, and the trail row it leaves. */
export interface DepositCollectionPlanModel {
  data: DepositCollectionStateModel;
  kind: "RECEIVED" | "WAIVED";
  note: string | null;
}

/**
 * Plans a collection write, or `null` when it would change NOTHING (a re-send of the same answer).
 * Declarative like the settlement: re-sending the same status keeps its ORIGINAL timestamp (when it
 * was first received/waived is the fact worth keeping); a waive re-sent with a different reason
 * updates the reason under the same timestamp. The two statuses are mutually exclusive, so every
 * write clears the other one.
 */
export function planDepositCollection(
  current: DepositCollectionStateModel,
  input: DepositCollectionRequestModel,
  now: Date,
): DepositCollectionPlanModel | null {
  if (input.received) {
    if (current.depositReceivedAt !== null) {
      return null;
    }
    return {
      data: { depositReceivedAt: now, depositWaivedAt: null, depositWaivedReason: null },
      kind: "RECEIVED",
      note: null,
    };
  }
  // The validator guarantees a reason whenever `received` is false.
  const reason = input.reason ?? null;
  if (current.depositWaivedAt !== null && current.depositWaivedReason === reason) {
    return null;
  }
  return {
    data: {
      depositReceivedAt: null,
      depositWaivedAt: current.depositWaivedAt ?? now,
      depositWaivedReason: reason,
    },
    kind: "WAIVED",
    note: reason,
  };
}

/**
 * Applies a collection write inside the caller's transaction: the `services` columns + ONE trail row
 * (`depositTotal` = the NOMINAL deposit at that moment, `note` = the waive reason). Returns whether
 * anything changed — nothing is written, and no row appended, for a re-send of the same answer.
 */
export async function applyDepositCollection(
  tx: Pick<Prisma.TransactionClient, "service" | "serviceDepositHistory">,
  args: {
    serviceId: number;
    current: DepositCollectionStateModel;
    input: DepositCollectionRequestModel;
    depositTotal: number;
    byUserId: number;
    now: Date;
  },
): Promise<boolean> {
  const plan = planDepositCollection(args.current, args.input, args.now);
  if (plan === null) {
    return false;
  }
  await tx.service.update({ where: { id: args.serviceId }, data: plan.data });
  await tx.serviceDepositHistory.create({
    data: {
      serviceId: args.serviceId,
      kind: plan.kind,
      note: plan.note,
      depositTotal: args.depositTotal,
      byUserId: args.byUserId,
    },
  });
  return true;
}

/**
 * The deposit asked AT THE DOOR ("¿Se recibió el depósito?" — the advance's `depositCollection`).
 * Applied ONLY when the walk confirms the delivery and the order's deposit is still pending — the
 * very rule (`pendingDepositToCollect`) that offered `depositToCollect`, judged on the state BEFORE
 * the move. Anything else — no answer, a stale screen, an order already recorded — is silently
 * ignored: the delivery is never blocked by it and an existing record is never overwritten.
 */
export async function applyDeliveryDepositCollection(
  tx: Pick<Prisma.TransactionClient, "service" | "serviceDepositHistory">,
  args: {
    order: Parameters<typeof pendingDepositToCollect>[0] & DepositCollectionStateModel & { id: number };
    input: DepositCollectionRequestModel | undefined;
    confirmsDelivery: boolean;
    byUserId: number;
    now: Date;
  },
): Promise<boolean> {
  const depositToCollect = pendingDepositToCollect(args.order);
  if (args.input === undefined || depositToCollect === undefined || !args.confirmsDelivery) {
    return false;
  }
  return applyDepositCollection(tx, {
    serviceId: args.order.id,
    current: args.order,
    input: args.input,
    depositTotal: depositToCollect,
    byUserId: args.byUserId,
    now: args.now,
  });
}
