import { Prisma } from "@prisma/client";
import { decryptKms } from "@helpers/encryption.js";
import { pendingLogisticsEvents } from "../orders/logistics/logistics.service.js";
import type { LogisticsEventModel } from "../orders/logistics/logistics.models.js";
import {
  orderListInclude,
  projectOrderListItem,
  type OrderProjectionContextModel,
} from "../orders/orders.service.js";
import type {
  DateRangeModel,
  RevenuePointModel,
  StatComparisonModel,
  UpNextItemResponseModel,
} from "./dashboard.models.js";

const MINUTE_MS = 60 * 1000;

/**
 * How many orders the "up next" queue shows. Three is the owner's number and it is a UX decision,
 * not a technical one: a queue you can hold in your head while driving.
 */
export const UP_NEXT_LIMIT = 3;

/** How many months of history the revenue trend covers, including the current (partial) one. */
export const TREND_MONTHS = 12;

/** How many products the "most rented" ranking lists. */
export const TOP_PRODUCTS_LIMIT = 5;

/**
 * The Prisma `include` for a dashboard order: the LIST shape plus nothing. The delivery snapshots
 * the up-next card needs (address, pin, instructions, contact) are plain columns on `services`, so
 * they arrive with the row itself — reusing `orderListInclude` verbatim is what keeps this endpoint
 * and the agenda projecting orders through the SAME function.
 */
export const dashboardOrderInclude = orderListInclude;

/** An order row as the dashboard fetches it — the list shape plus the encrypted delivery snapshots. */
export type DashboardOrderRow = Prisma.ServiceGetPayload<{
  include: typeof dashboardOrderInclude;
}>;

/**
 * The calendar month containing `now`, shifted by `offsetMonths` (0 = this month, -1 = last month).
 *
 * Half-open `[from, to)` so an order timestamped exactly at midnight on the 1st belongs to the new
 * month and to nothing else. Built from local Y/M parts, which is correct here because the business
 * is single-timezone (Guatemala, no DST — EPIC-2 §1); a multi-timezone business would need the
 * month boundaries computed in the BUSINESS's zone, not the server's, and this is the one function
 * that would change.
 */
export function monthRange(now: Date, offsetMonths = 0): DateRangeModel {
  const from = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 1);
  return { from, to };
}

/** The local day containing `now`, half-open like every other range here. */
export function dayRange(now: Date): DateRangeModel {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from, to };
}

/** `YYYY-MM` for a date — the trend series' stable machine key (the client formats the label). */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The trailing `count` months ending with the one containing `now`, oldest first. Returned as keys
 * rather than ranges because the bucketing below is a lookup, not a series of comparisons.
 */
export function trailingMonthKeys(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    monthKey(new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1)),
  );
}

/**
 * Percentage change from `previous` to `current`, or `undefined` when `previous` is 0.
 *
 * The absence is the point: every "+100%" or "+∞%" badge on a month that started from nothing is a
 * lie dressed as insight. The client renders "sin comparación" when this is absent, which is both
 * true and useful. Rounded to one decimal — more precision than that is noise on a monthly figure.
 */
export function percentDelta(current: number, previous: number): number | undefined {
  if (previous === 0) {
    return undefined;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Pairs a figure with its predecessor and the delta between them. */
export function compare(current: number, previous: number): StatComparisonModel {
  const delta = percentDelta(current, previous);
  return { current, previous, ...(delta !== undefined && { deltaPercent: delta }) };
}

/**
 * The one event an order still has to perform NEXT, or `null` when it has none (finished, cancelled,
 * or a purchase-only order already delivered).
 *
 * Built on {@link pendingLogisticsEvents}, which is the single source of "what is still owed" — the
 * same predicate the driver-availability pad uses. That reuse is what makes the dashboard agree with
 * the calendar automatically: a rewind clears an actual, the event becomes pending again, and it
 * reappears here without this file knowing anything about statuses.
 */
export function nextPendingEvent(order: {
  deliveryAt: Date;
  pickupAt: Date | null;
  deliveredAt: Date | null;
  collectedAt: Date | null;
  cancelledAt: Date | null;
}): LogisticsEventModel | null {
  const pending = pendingLogisticsEvents(order);
  if (pending.length === 0) {
    return null;
  }
  return pending.reduce((earliest, event) =>
    event.at.getTime() < earliest.at.getTime() ? event : earliest,
  );
}

/**
 * Picks the `limit` orders whose next pending event is soonest, earliest first.
 *
 * Orders with nothing pending drop out entirely. Ties break by order id so the list is stable across
 * refetches — two deliveries scheduled for the same minute must not swap places every 60 seconds.
 */
export function selectUpNext<T extends { id: number }>(
  rows: readonly T[],
  eventOf: (row: T) => LogisticsEventModel | null,
  limit: number,
): { row: T; event: LogisticsEventModel }[] {
  return rows
    .flatMap((row) => {
      const event = eventOf(row);
      return event ? [{ row, event }] : [];
    })
    .sort(
      (a, b) => a.event.at.getTime() - b.event.at.getTime() || a.row.id - b.row.id,
    )
    .slice(0, limit);
}

/**
 * Projects one up-next slot: the ORDER LIST item (so `actions`, `status` and `holdsInventory` come
 * from the very same projection the agenda uses) plus the event this slot is about and the delivery
 * snapshots the driver needs to actually get there.
 *
 * `minutesUntil` is computed against `now` — the payload's `generatedAt` — and not left to the
 * browser: a device with a skewed clock would otherwise disagree with the server about what is
 * overdue, and "overdue" is the one label on this screen that must be trusted.
 */
export function projectUpNextItem(
  order: DashboardOrderRow,
  event: LogisticsEventModel,
  context: OrderProjectionContextModel,
  now: Date,
): UpNextItemResponseModel {
  return {
    ...projectOrderListItem(order, context),
    event: {
      kind: event.kind,
      at: event.at,
      isOverdue: event.at.getTime() < now.getTime(),
      minutesUntil: Math.round((event.at.getTime() - now.getTime()) / MINUTE_MS),
    },
    deliveryAddress: decryptKms(order.deliveryAddressKms),
    ...(order.deliveryInstructionsKms && {
      deliveryInstructions: decryptKms(order.deliveryInstructionsKms),
    }),
    deliveryContact: decryptKms(order.deliveryContactKms),
  };
}

/**
 * Buckets raw `(deliveryAt, totalAmount)` pairs into the trailing-months series, oldest first, with
 * empty months present as zeros — a gap in a bar chart must read as "no business that month", never
 * as a missing bar the eye skips over.
 *
 * Bucketing happens in memory ON PURPOSE rather than as a `date_trunc` group-by: at this business's
 * scale a year is a few hundred rows, and keeping it here makes the month boundaries obey exactly
 * the same {@link monthKey} rule as the rest of the screen instead of Postgres's timezone handling.
 * **The trigger to move it into SQL** is the year's order count reaching a few thousand — at which
 * point it becomes one `date_trunc('month', delivery_at)` group-by and this function's tests become
 * that query's contract.
 */
export function bucketRevenueByMonth(
  rows: readonly { deliveryAt: Date; totalAmount: Prisma.Decimal }[],
  now: Date,
  months: number,
): RevenuePointModel[] {
  const series = new Map<string, RevenuePointModel>(
    trailingMonthKeys(now, months).map((month) => [
      month,
      { month, revenue: 0, orders: 0 },
    ]),
  );
  for (const row of rows) {
    const bucket = series.get(monthKey(row.deliveryAt));
    // A row outside the window can only appear if the query and this call disagree about the range;
    // ignoring it keeps the series honest rather than inventing a 13th bar.
    if (bucket) {
      bucket.revenue = round2(bucket.revenue + Number(row.totalAmount));
      bucket.orders += 1;
    }
  }
  return [...series.values()];
}

/** Money rounded to cents — repeated float addition otherwise surfaces as `1234.5600000000002`. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * What is still owed to the business: the total of orders that are not cancelled and not marked
 * paid, minus whatever deposit was already taken. Clamped at zero per order — a deposit larger than
 * the total is a data-entry slip, and surfacing it as negative "por cobrar" would quietly reduce the
 * headline figure instead of showing the real one.
 */
export function outstandingFrom(
  rows: readonly { totalAmount: Prisma.Decimal; depositAmount: Prisma.Decimal | null }[],
): { amount: number; orders: number } {
  let amount = 0;
  let orders = 0;
  for (const row of rows) {
    const owed = Number(row.totalAmount) - Number(row.depositAmount ?? 0);
    if (owed > 0) {
      amount = round2(amount + owed);
      orders += 1;
    }
  }
  return { amount, orders };
}
