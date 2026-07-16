import { Prisma } from "@prisma/client";
import { appConfig } from "@/config/app.js";
import { decryptKms } from "@helpers/encryption.js";
import {
  type OrderDetailResponseModel,
  type OrderListItemResponseModel,
  type OrderListQueryModel,
  type OrderListViewModel,
} from "./orders.models.js";

/**
 * The Prisma `include` for the order LIST — deliberately lean: the lookups the list item shows and
 * the line quantities (for `itemCount`), nothing PII-heavy beyond the client-name snapshot the row
 * itself carries. The detail's richer shape is `richOrderInclude` below.
 */
export const orderListInclude = {
  eventType: { select: { id: true, name: true } },
  serviceStatus: { select: { id: true, name: true } },
  paymentStatus: { select: { id: true, name: true } },
  currency: {
    select: { id: true, iso4217Code: true, name: true, symbol: true },
  },
  serviceDetails: { where: { isActive: true }, select: { quantity: true } },
} satisfies Prisma.ServiceInclude;

/** An order row fetched with `orderListInclude` — the list projection's input. */
export type OrderListRow = Prisma.ServiceGetPayload<{
  include: typeof orderListInclude;
}>;

/**
 * The Prisma `include` for the FULL order shape (`GET /orders/:id`): everything the detail page
 * renders — active lines with their product names, active extras, the assigned driver, and the
 * append-only status audit trail in chronological order. A superset of `orderListInclude`, so a
 * `RichOrder` feeds the list projection too (the detail response extends the list item).
 */
export const richOrderInclude = {
  eventType: { select: { id: true, name: true } },
  serviceStatus: { select: { id: true, name: true } },
  paymentStatus: { select: { id: true, name: true } },
  currency: {
    select: { id: true, iso4217Code: true, name: true, symbol: true },
  },
  assignedUser: { select: { id: true, fullNameKms: true } },
  serviceDetails: {
    where: { isActive: true },
    select: {
      id: true,
      productId: true,
      quantity: true,
      isRental: true,
      unitaryPrice: true,
      parcialPrice: true,
      product: { select: { name: true } },
    },
  },
  serviceExtras: {
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      description: true,
      quantity: true,
      unitaryPrice: true,
      parcialPrice: true,
    },
  },
  statusHistory: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      createdAt: true,
      fromStatus: { select: { id: true, name: true } },
      toStatus: { select: { id: true, name: true } },
      byUser: { select: { fullNameKms: true } },
    },
  },
} satisfies Prisma.ServiceInclude;

/** An order row fetched with `richOrderInclude` — the detail projection's input. */
export type RichOrder = Prisma.ServiceGetPayload<{
  include: typeof richOrderInclude;
}>;

/** A Prisma `Decimal | null` money column → a plain `number` (or `undefined` when absent). */
const toMoney = (value: Prisma.Decimal | null): number | undefined =>
  value !== null ? Number(value) : undefined;

/** Every accepted `view` value — the parse allowlist (anything else clamps to the default). */
export const ORDER_LIST_VIEWS: readonly OrderListViewModel[] = [
  "agenda",
  "history",
];

/**
 * Parses the `GET /orders` query into a safe {@link OrderListQueryModel}. Everything **clamps or
 * drops, never rejects** (the products-list stance): bad pagination falls back (`page` floors at 1,
 * `pageSize` bounds to `[1, maxOrderPageSize]`), an unknown `view` clamps to `agenda`, and a bad
 * `statusId` filter simply drops out — so this shape is always safe to hand to Prisma and there is
 * no 400 to handle.
 */
export function parseOrderListQuery(query: unknown): OrderListQueryModel {
  const source = (query ?? {}) as Record<string, unknown>;
  const page = clampInt(source["page"], 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(
    source["pageSize"],
    appConfig.defaultOrderPageSize,
    1,
    appConfig.maxOrderPageSize,
  );
  const rawView = source["view"];
  const view = ORDER_LIST_VIEWS.find((value) => value === rawView) ?? "agenda";
  const statusId = parsePositiveInt(source["statusId"]);
  return { page, pageSize, view, statusId };
}

/**
 * Which rows each view returns — THE agenda/history split, in one place. An order is **history**
 * exactly when it is finished (`readyAt` set — the explicit "listo" press, owner decision §2) or
 * cancelled; everything else is still WORK and belongs to the agenda, including a COLLECTED order
 * whose "listo" hasn't been pressed yet. Orders are never deleted (no-trash: cancelled is a state),
 * but `isActive` is still honoured defensively. A nonexistent `statusId` filter matches nothing —
 * consistent with the clamp stance, no 400.
 */
export function buildOrderListWhere(
  query: OrderListQueryModel,
): Prisma.ServiceWhereInput {
  const viewPredicate: Prisma.ServiceWhereInput =
    query.view === "history"
      ? { OR: [{ cancelledAt: { not: null } }, { readyAt: { not: null } }] }
      : { cancelledAt: null, readyAt: null };
  return {
    isActive: true,
    ...viewPredicate,
    ...(query.statusId !== undefined
      ? { serviceStatusId: query.statusId }
      : {}),
  };
}

/**
 * Each view's presentation order, `id` tiebreaking same-timestamp rows so pages never shuffle:
 * the agenda reads like a schedule (soonest delivery first), history like a log (newest first).
 */
export function orderListOrderBy(
  view: OrderListViewModel,
): Prisma.ServiceOrderByWithRelationInput[] {
  return view === "history"
    ? [{ deliveryAt: "desc" }, { id: "desc" }]
    : [{ deliveryAt: "asc" }, { id: "asc" }];
}

/**
 * Projects an order row to the LIST item shape. This is the **Admin** projection — the only role
 * the orders routes mount today. When the Client (own orders) and Driver (assigned logistics)
 * slices arrive, grow this into the role-tiered single source (`projectServiceForRole` doctrine,
 * EPIC-2 §7) — extend HERE, never fork per endpoint.
 */
export function projectOrderListItem(
  order: OrderListRow,
): OrderListItemResponseModel {
  return {
    id: order.id,
    clientName: decryptKms(order.deliveryNameKms),
    isRegistryClient: order.clientRegistryId !== null,
    eventType: order.eventType,
    status: order.serviceStatus,
    paymentStatus: order.paymentStatus,
    deliveryAt: order.deliveryAt,
    pickupAt: order.pickupAt ?? undefined,
    deliveredAt: order.deliveredAt ?? undefined,
    collectedAt: order.collectedAt ?? undefined,
    readyAt: order.readyAt ?? undefined,
    cancelledAt: order.cancelledAt ?? undefined,
    itemCount: order.serviceDetails.reduce(
      (sum, line) => sum + line.quantity,
      0,
    ),
    totalAmount: Number(order.totalAmount),
    currency: {
      id: order.currency.id,
      iso4217Code: order.currency.iso4217Code,
      name: order.currency.name,
      symbol: order.currency.symbol,
    },
  };
}

/**
 * Projects a rich order row to the DETAIL shape: the list item plus the decrypted snapshots
 * (contact/address — captured at order time, never live registry data), the billed period, the
 * money breakdown, lines/extras, and the status audit trail. Same Admin-projection stance (and
 * future role-tier home) as {@link projectOrderListItem}.
 */
export function projectOrderDetail(order: RichOrder): OrderDetailResponseModel {
  return {
    ...projectOrderListItem(order),
    deliveryContact: decryptKms(order.deliveryContactKms),
    deliveryAddress: decryptKms(order.deliveryAddressKms),
    description: order.description ?? undefined,
    comment: order.comment ?? undefined,
    assignedUser: order.assignedUser
      ? {
          id: order.assignedUser.id,
          name: decryptKms(order.assignedUser.fullNameKms),
        }
      : undefined,
    deliveryAmount: toMoney(order.deliveryAmount),
    depositAmount: toMoney(order.depositAmount),
    discountAmount: toMoney(order.discountAmount),
    discountReason: order.discountReason ?? undefined,
    paidAt: order.paidAt ?? undefined,
    cancelReason: order.cancelReason ?? undefined,
    serviceStart: order.serviceStart,
    serviceEnd: order.serviceEnd,
    lines: order.serviceDetails.map((line) => ({
      id: line.id,
      productId: line.productId,
      productName: line.product.name,
      isRental: line.isRental,
      quantity: line.quantity,
      unitaryPrice: Number(line.unitaryPrice),
      parcialPrice: Number(line.parcialPrice),
    })),
    extras: order.serviceExtras.map((extra) => ({
      id: extra.id,
      name: extra.name,
      description: extra.description ?? undefined,
      quantity: extra.quantity ?? undefined,
      unitaryPrice: toMoney(extra.unitaryPrice),
      parcialPrice: toMoney(extra.parcialPrice),
    })),
    statusHistory: order.statusHistory.map((entry) => ({
      id: entry.id,
      from: entry.fromStatus ?? undefined,
      to: entry.toStatus,
      byUserName: decryptKms(entry.byUser.fullNameKms),
      at: entry.createdAt,
    })),
    createdAt: order.createdAt,
  };
}

/** Parse `value` to a positive integer, or `undefined` when it isn't one (the filter drops out).
 *  (Mirrors products.service's private helper — promote to `@helpers/utils` at a third consumer.) */
function parsePositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

/** Parse `value` to an integer and clamp it to `[min, max]`; non-integers fall back to `fallback`.
 *  (Mirrors products.service's private helper — promote to `@helpers/utils` at a third consumer.) */
function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}
