import type { OrderDepositCollectionStatus } from './order.types';

/** Which way the money moves once everything is squared. */
export type OrderBalanceDirection = 'collect' | 'refund' | 'none';

export interface OrderBalanceInput {
  /** The SERVICE cost (`totalAmount`) — never includes the deposit. */
  total: number;
  /** Anticipo already received (`OrderDetail.depositAmount`; 0 when absent). */
  advance: number;
  /** The order is marked paid (`paidAt` set) — nothing of the service cost is owed any more. */
  paid: boolean;
  /** The refundable deposit, when the order carries one (absent ⇒ none). */
  deposit?: { amount: number; status: OrderDepositCollectionStatus };
  /** The recorded damage report's `claimsTotal` (retention + lost/broken units). `undefined` ⇒ no
   *  report yet; `0` ⇒ reported clean. */
  claimsTotal?: number;
}

export interface OrderBalance {
  /** What is left of the service cost: 0 once paid, else `total − advance` (never negative). */
  serviceDue: number;
  /** What an anticipo LARGER than the service cost leaves over — paid or not — once a deposit in
   *  hand (received, or credited by the report) has absorbed its share: that excess is usually the
   *  deposit itself. Credited in the sum ("Saldo a favor"), never thrown away. 0 otherwise. */
  advanceCredit: number;
  /** BEFORE the report: the deposit still to be handed over (PENDING) — added to what is paid,
   *  kept apart from the cost. 0 once received, waived, or after the report. */
  depositDue: number;
  /** BEFORE the report: a deposit already in our hands — shown for information, NOT in the sum
   *  (it comes back at pickup). 0 otherwise. */
  depositOnHand: number;
  /** AFTER the report: the deposit credited back against what is owed (0 when waived). */
  depositCredit: number;
  /** AFTER the report: retention + lost/broken units. */
  claims: number;
  /** The single amount to move, always ≥ 0 — `direction` says who pays whom. */
  amount: number;
  direction: OrderBalanceDirection;
}

const cents = (value: number): number => Math.round(value * 100) / 100;

/**
 * SQUARES an order: one place that turns cost, anticipo, payment, deposit and damages into the ONE
 * amount that has to change hands and which way — the highlighted figure on the order page and on
 * every document (comprobante, cotización, reporte de daños), so no two surfaces can disagree.
 *
 * - **Before the damage report** the client owes the rest of the service PLUS a deposit not yet
 *   handed over: the deposit is money they must PAY to get the service, even though it is not a cost
 *   and comes back. A deposit already received is informational (`depositOnHand`), not summed.
 * - **After the report** the deposit is credited back against everything owed — the rest of the
 *   service and the damages — so the result is either a balance to COLLECT or a REFUND to give.
 *   A PENDING collection counts as received here (recording a report confirms it, server-side).
 * - **WAIVED** = no deposit at all: nothing is due, nothing is credited, damages are billed whole.
 *
 * Pure arithmetic over figures the API reported — it never decides a server consequence.
 */
export function squareOrderBalance(input: OrderBalanceInput): OrderBalance {
  const serviceDue = input.paid ? 0 : Math.max(0, cents(input.total - input.advance));
  const depositAmount =
    input.deposit !== undefined && input.deposit.status !== 'WAIVED' ? input.deposit.amount : 0;
  const reported = input.claimsTotal !== undefined;

  const depositDue = !reported && input.deposit?.status === 'PENDING' ? depositAmount : 0;
  const depositOnHand = !reported && input.deposit?.status === 'RECEIVED' ? depositAmount : 0;
  const depositCredit = reported ? depositAmount : 0;
  // An anticipo above the cost is, in practice, the deposit sent along with it. Once that deposit
  // counts as in hand (received, or credited back by the report) the excess IS it — crediting both
  // would hand it back twice. Only what is left over is a genuine `Saldo a favor`. Paid or not:
  // marking the order paid settles the cost, it does not swallow money received above it.
  const advanceCredit = Math.max(
    0,
    cents(input.advance - input.total - depositOnHand - depositCredit),
  );
  const claims = input.claimsTotal ?? 0;

  const signed = cents(serviceDue + depositDue + claims - depositCredit - advanceCredit);
  return {
    serviceDue,
    advanceCredit,
    depositDue,
    depositOnHand,
    depositCredit,
    claims,
    amount: Math.abs(signed),
    direction: signed > 0 ? 'collect' : signed < 0 ? 'refund' : 'none',
  };
}
