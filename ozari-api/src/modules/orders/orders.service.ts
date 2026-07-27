import { Prisma } from "@prisma/client";
import { appConfig } from "@/config/app.js";
import { decryptKms } from "@helpers/encryption.js";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { RentTimeUnitEnum } from "@models/enums/rentTimeUnitEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  describeActions,
  getEvidenceBounds,
  getStatusCatalog,
  nextStatus,
  statusById,
} from "./lifecycle/lifecycle.service.js";
import type {
  ActorContextModel,
  EvidenceBoundsModel,
  LifecycleOrderModel,
  StatusDefinitionModel,
} from "./lifecycle/lifecycle.models.js";
import {
  type OrderDetailResponseModel,
  type OrderListItemResponseModel,
  type OrderListQueryModel,
  type OrderListViewModel,
  type OrderStockConflictItemModel,
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
  // The assigned driver (the admin is also a driver) — drives the list item's `assignee` + `isMine`
  // so the agenda can group MINE vs the rest and gate the per-order quick action to my own orders.
  assignedUser: { select: { id: true, fullNameKms: true } },
  // `isRental` rides along with the quantities: it is the order's MODE (any rental line ⇒ a rental
  // order), which decides which pipeline steps apply — the lifecycle projection needs it per row.
  serviceDetails: {
    where: { isActive: true },
    select: { quantity: true, isRental: true },
  },
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
  paymentMethod: { select: { id: true, name: true } },
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

/**
 * The roles an order can be ASSIGNED to — the "deliverable" staff (the Admin also drives). This is
 * the SINGLE source: the `/orders/catalog` "Asignar a" options and the create validator both read it,
 * so widening it (an office runner, a dedicated delivery role, …) opens assignment everywhere at once.
 */
export const ASSIGNABLE_ROLES: readonly RolesEnum[] = [
  RolesEnum.Admin,
  RolesEnum.Driver,
];

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
  scopeUserId?: number,
): Prisma.ServiceWhereInput {
  const viewPredicate: Prisma.ServiceWhereInput =
    query.view === "history"
      ? { OR: [{ cancelledAt: { not: null } }, { readyAt: { not: null } }] }
      : { cancelledAt: null, readyAt: null };
  return {
    isActive: true,
    ...viewPredicate,
    // Row scoping: a Driver sees ONLY orders assigned to them (`scopeUserId` = their id); Admin gets
    // every order (`scopeUserId` undefined → no assignee filter). The route guard keeps Clients out.
    ...(scopeUserId !== undefined ? { assignedUserId: scopeUserId } : {}),
    ...(query.statusId !== undefined
      ? { serviceStatusId: query.statusId }
      : {}),
  };
}

/** The scalar shape `computeNextActionAt`/`sortAgendaRows` need — every field is a plain `Service`
 *  column, so both a lean list row and a rich detail row satisfy it. */
export interface AgendaSortableOrder {
  id: number;
  assignedUserId: number | null;
  deliveryAt: Date;
  pickupAt: Date | null;
  deliveredAt: Date | null;
  collectedAt: Date | null;
}

/**
 * The moment of an order's NEXT logistics action — the sort key that makes the agenda read as "what
 * do I touch next", not "what was created/delivered first" (owner rule). Derived from the tracked
 * ACTUALS, never from a status id (EPIC-2 order lifecycle): the statuses that stamp them are
 * admin-configurable, but "it has been collected" / "it has been delivered" are facts.
 *
 * - collected ⇒ its collection moment (it's waiting out the washing period for the "listo" press);
 * - delivered ⇒ its PICKUP (a purchase-only order has none → its delivery moment stands in);
 * - otherwise ⇒ its DELIVERY.
 *
 * So an order delivered early but picked up in an hour sorts AHEAD of one merely delivering in six.
 * Cancelled/finished rows live in history, never here.
 */
export function computeNextActionAt(order: AgendaSortableOrder): Date {
  if (order.collectedAt !== null) {
    return order.collectedAt;
  }
  if (order.deliveredAt !== null) {
    return order.pickupAt ?? order.deliveredAt;
  }
  return order.deliveryAt;
}

/**
 * Orders the AGENDA the way the worker reads it: **MINE first** (assigned to `currentUserId`), then
 * the rest; within each, soonest {@link computeNextActionAt} first, `id` breaking ties so pages never
 * shuffle. Pure (sorts a copy). For a Driver every row is theirs, so it collapses to a pure
 * next-action ordering; for the Admin it floats their own assignments to the top. The active set is
 * small (single-vehicle logistics), so sorting it in memory is cheaper than a per-row SQL expression.
 */
export function sortAgendaRows<T extends AgendaSortableOrder>(
  rows: T[],
  currentUserId: number,
): T[] {
  return [...rows].sort((a, b) => {
    const aMine = a.assignedUserId === currentUserId ? 0 : 1;
    const bMine = b.assignedUserId === currentUserId ? 0 : 1;
    if (aMine !== bMine) {
      return aMine - bMine;
    }
    const byAction =
      computeNextActionAt(a).getTime() - computeNextActionAt(b).getTime();
    return byAction !== 0 ? byAction : a.id - b.id;
  });
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
 * The lifecycle context a projection needs: the cached status catalog, WHO is asking (the actor
 * whose permitted actions get projected), and the global evidence bounds. Built ONCE per request
 * (`loadOrderProjectionContext`) and threaded into every row — projections stay query-free.
 */
export interface OrderProjectionContextModel {
  catalog: StatusDefinitionModel[];
  actor: ActorContextModel;
  evidence: EvidenceBoundsModel;
}

/** The order-shaped input the lifecycle engine reasons about, derived from a fetched row: its
 *  current status, its assignee (the driver scope check) and whether ANY line is a rental (the
 *  mode that decides which pipeline steps apply). */
export function toLifecycleOrder(order: {
  serviceStatusId: number;
  assignedUserId: number | null;
  cancelledAt: Date | null;
  serviceDetails: ReadonlyArray<{ isRental: boolean }>;
}): LifecycleOrderModel {
  return {
    serviceStatusId: order.serviceStatusId,
    assignedUserId: order.assignedUserId,
    cancelledAt: order.cancelledAt,
    isRental: order.serviceDetails.some((line) => line.isRental),
  };
}

/**
 * Loads everything the projections need from the lifecycle machine — once per request, not per row.
 * The catalog is memoized in-process (admin edits invalidate it), so this is normally free.
 */
export async function loadOrderProjectionContext(
  actor: ActorContextModel,
): Promise<OrderProjectionContextModel> {
  const [catalog, evidence] = await Promise.all([
    getStatusCatalog(),
    getEvidenceBounds(),
  ]);
  return { catalog, actor, evidence };
}

/**
 * Projects an order row to the LIST item shape. This is the **Admin/Driver** projection — the roles
 * the orders routes mount today; the row's `actions` are already narrowed to what THIS actor may do
 * (the engine's permission matrix), so a driver never receives a move they can't make. When the
 * Client (own orders) slice arrives, grow this into the role-tiered single source
 * (`projectServiceForRole` doctrine, EPIC-2 §7) — extend HERE, never fork per endpoint.
 */
export function projectOrderListItem(
  order: OrderListRow,
  context: OrderProjectionContextModel,
): OrderListItemResponseModel {
  const currentUserId = context.actor.userId;
  const lifecycleOrder = toLifecycleOrder(order);
  const next = nextStatus(context.catalog, lifecycleOrder);
  return {
    id: order.id,
    clientName: decryptKms(order.deliveryNameKms),
    isRegistryClient: order.clientRegistryId !== null,
    eventType: order.eventType,
    status: {
      ...order.serviceStatus,
      colorKey:
        statusById(context.catalog, order.serviceStatusId)?.colorKey ??
        undefined,
    },
    nextStatus: next ? { id: next.id, name: next.name } : undefined,
    actions: describeActions(
      context.catalog,
      lifecycleOrder,
      context.actor,
      context.evidence,
    ),
    paymentStatus: order.paymentStatus,
    deliveryAt: order.deliveryAt,
    pickupAt: order.pickupAt ?? undefined,
    deliveredAt: order.deliveredAt ?? undefined,
    collectedAt: order.collectedAt ?? undefined,
    readyAt: order.readyAt ?? undefined,
    cancelledAt: order.cancelledAt ?? undefined,
    // The assigned driver + whether it's the viewer's own: the agenda groups MINE vs the rest and
    // shows the quick action only on `isMine` rows (a Driver's rows are all theirs; an unassigned
    // order is never anyone's). `assignee` is absent while unassigned ("Sin asignar").
    assignee: order.assignedUser
      ? { id: order.assignedUser.id, name: decryptKms(order.assignedUser.fullNameKms) }
      : undefined,
    isMine: order.assignedUserId === currentUserId,
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
export function projectOrderDetail(
  order: RichOrder,
  context: OrderProjectionContextModel,
): OrderDetailResponseModel {
  return {
    // The list item already projects the assigned driver as `assignee` (+ `isMine`) — the detail
    // inherits it, so there is no separate `assignedUser` field to keep in sync.
    ...projectOrderListItem(order, context),
    deliveryContact: decryptKms(order.deliveryContactKms),
    deliveryAddress: decryptKms(order.deliveryAddressKms),
    description: order.description ?? undefined,
    comment: order.comment ?? undefined,
    deliveryAmount: toMoney(order.deliveryAmount),
    depositAmount: toMoney(order.depositAmount),
    paymentMethod: order.paymentMethod ?? undefined,
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

// ── Order creation (the write slice) ─────────────────────────────────────────────────────────────

/** The order's identity/timing/stock rules couldn't be met — thrown INSIDE the create transaction
 *  (rolls it back) and mapped to a structured `409` (EPIC-2 §8: tell the admin exactly which lines
 *  lack stock and the counts, so the form can re-offer). */
export class OrderStockConflictError extends Error {
  constructor(readonly conflicts: OrderStockConflictItemModel[]) {
    super("order stock conflict");
    this.name = "OrderStockConflictError";
  }
}

/** Another confirmed order has a logistics event too close to this one (the single-vehicle
 *  spacing rule) — also a `409`; the admin is blocked exactly like a client (owner decision). */
export class OrderSpacingConflictError extends Error {
  constructor(readonly conflictAt: Date) {
    super("order spacing conflict");
    this.name = "OrderSpacingConflictError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Billed days over the delivery→pickup window (owner rule, §2): billing is ALWAYS per day —
 * `< 24h` = 1 day, then one more per **started** 24h block (the pickup time decides; exactly 24h
 * is still one day). The validator guarantees `pickupAt > deliveryAt`.
 */
export function computeBilledDays(deliveryAt: Date, pickupAt: Date): number {
  return Math.max(1, Math.ceil((pickupAt.getTime() - deliveryAt.getTime()) / DAY_MS));
}

/**
 * The `orders.logisticsSpacingMinutes` app preference, parsed defensively: a missing row or a
 * non-positive/corrupt value falls back to the seeded default. (Every operational "constant" is an
 * admin preference — the code must read the DB value, never hardcode the hour.)
 */
export function parseSpacingMinutes(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : appConfig.defaultLogisticsSpacingMinutes;
}

/**
 * The `service_details` filter selecting every RENTAL line that holds units against the requested
 * `[windowStart, windowEnd]` window — the order-time twin of products' `buildRentedNowWhere`
 * (EPIC-1 §5 obligation: validation runs the same rule against the EVENT's window, not `now`), and
 * likewise driven by the lifecycle flags rather than hardcoded ids:
 *
 * - `inventoryHold = OUT` statuses hold unconditionally — the units are on the truck, at the event,
 *   or back but still being washed, so they can't be promised to anyone whatever the window;
 * - `WINDOW` statuses hold only when their own billed period overlaps the requested one (half-open
 *   overlap: a pickup at 10:00 doesn't collide with a delivery at 10:00 — the spacing rule, not
 *   availability, governs that gap);
 * - `NONE` statuses and soft-deleted rows never hold, and SALE lines never hold (their stock was
 *   decremented at creation).
 */
export function buildRentedInWindowWhere(
  productIds: number[],
  windowStart: Date,
  windowEnd: Date,
  holding: { out: number[]; window: number[] },
): Prisma.ServiceDetailWhereInput {
  return {
    productId: { in: productIds },
    isActive: true,
    isRental: true,
    service: {
      isActive: true,
      cancelledAt: null,
      OR: [
        { serviceStatusId: { in: holding.out } },
        {
          serviceStatusId: { in: holding.window },
          serviceStart: { lt: windowEnd },
          serviceEnd: { gt: windowStart },
        },
      ],
    },
  };
}

/**
 * The `services` filter selecting any order with a logistics event closer than `spacingMinutes` to
 * ANY of the new order's events (its delivery, and its pickup when it has one) — the global
 * single-vehicle rule (§2): the system must BLOCK the admin too. Exclusive bounds: exactly the
 * spacing apart is allowed ("minimum 1 hour BETWEEN"). Cancelled orders don't block; completed
 * ones need no exclusion — their events sit in the past, so time proximity filters them naturally.
 */
export function buildSpacingConflictWhere(
  events: Date[],
  spacingMinutes: number,
): Prisma.ServiceWhereInput {
  const delta = spacingMinutes * 60 * 1000;
  const ranges = events.map((event) => ({
    gt: new Date(event.getTime() - delta),
    lt: new Date(event.getTime() + delta),
  }));
  return {
    isActive: true,
    cancelledAt: null,
    OR: ranges.flatMap((range) => [{ deliveryAt: range }, { pickupAt: range }]),
  };
}

/** A product row as the pricing needs it (fetched under the creation lock). */
export interface OrderPricingProductModel {
  id: number;
  name: string;
  productBusinessTypeId: number;
  rentTimeUnitId: number | null;
  rentPrice: Prisma.Decimal | null;
  sellPrice: Prisma.Decimal | null;
}

/** One priced line, ready for the nested `service_details` create. */
export interface PricedOrderLineModel {
  productId: number;
  quantity: number;
  isRental: boolean;
  unitaryPrice: number;
  parcialPrice: number;
}

/** Round money HALF-UP to cents once, at the final multiplication. */
const roundMoney = (value: number): number => Math.round(value * 100) / 100;

/**
 * Prices one requested line from ITS PRODUCT ROW — the single place order money is derived; a
 * client-sent price is never trusted. Rental lines bill `rentPrice × qty × billedDays` when the
 * unit is **Día** and flat `rentPrice × qty` for **Evento** (duration-agnostic by definition);
 * sale lines bill `sellPrice × qty` once. Other rent units (Hora/Semana/Mes) are rejected upstream
 * by the validator — the MVP billing engine is day-based (owner: day is THE norm; the hourly door
 * stays open and gets real math when a product actually needs it, never silent wrong billing).
 * `null` = the product violates the conditional price rule (defensive; the validator checked).
 */
export function priceOrderLine(
  quantity: number,
  product: OrderPricingProductModel,
  billedDays: number,
): PricedOrderLineModel | null {
  const isRental = product.productBusinessTypeId === BusinessTypeEnum.RENT;
  const unitPrice = isRental ? product.rentPrice : product.sellPrice;
  if (unitPrice === null) {
    return null;
  }
  const unitaryPrice = Number(unitPrice);
  const multiplier =
    isRental && product.rentTimeUnitId === RentTimeUnitEnum.Dia ? billedDays : 1;
  return {
    productId: product.id,
    quantity,
    isRental,
    unitaryPrice,
    parcialPrice: roundMoney(unitaryPrice * quantity * multiplier),
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
