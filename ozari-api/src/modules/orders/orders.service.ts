import { Prisma } from "@prisma/client";
import { appConfig } from "@/config/app.js";
import { decryptKms } from "@helpers/encryption.js";
import { decodeCoords } from "@helpers/geo.js";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { RentTimeUnitEnum } from "@models/enums/rentTimeUnitEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  currentHoldings,
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
  // The tracking photos, each tagged with the STEP it documents — the detail page groups them under
  // that step. (Rewinding a step deletes its photos; a retention purge deletes old ones. Both simply
  // leave fewer rows here, which is why the page renders from what exists rather than a count.)
  evidences: {
    orderBy: { id: "asc" },
    select: { id: true, serviceStatusId: true, url: true, createdAt: true },
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
 *  current status, its assignee (the driver scope check), which inventories its lines touch (rental
 *  decides which pipeline steps apply; sale decides what a cancel can give back) and the two facts
 *  that end a reservation for good — cancelled, delivered. */
export function toLifecycleOrder(order: {
  serviceStatusId: number;
  assignedUserId: number | null;
  cancelledAt: Date | null;
  deliveredAt: Date | null;
  serviceDetails: ReadonlyArray<{ isRental: boolean }>;
}): LifecycleOrderModel {
  return {
    serviceStatusId: order.serviceStatusId,
    assignedUserId: order.assignedUserId,
    cancelledAt: order.cancelledAt,
    deliveredAt: order.deliveredAt,
    isRental: order.serviceDetails.some((line) => line.isRental),
    isSale: order.serviceDetails.some((line) => !line.isRental),
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
  const holdings = currentHoldings(context.catalog, lifecycleOrder);
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
    // Does this order reserve anything at all right now? The delete dialog states the consequence
    // from THIS, never from a guess: a finished or cancelled order gave its goods back long ago, so
    // promising that deleting it "returns units to inventory" would simply be false.
    holdsInventory: holdings.rental || holdings.sale,
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
    clientRegistryId: order.clientRegistryId ?? undefined,
    deliveryContact: decryptKms(order.deliveryContactKms),
    deliveryAddress: decryptKms(order.deliveryAddressKms),
    // Total by construction: an unreadable pin projects as "no pin", so the maps button silently
    // falls back to the address text instead of the detail page failing to render. The guard is
    // TRUTHINESS, not `!== null`: an absent column (an older row read through a narrower select)
    // and an empty ciphertext must both mean "no pin" rather than reach `decryptKms`.
    deliveryCoords: order.deliveryCoordsKms
      ? decodeCoords(decryptKms(order.deliveryCoordsKms))
      : undefined,
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
    evidence: order.evidences.map((photo) => ({
      id: photo.id,
      statusId: photo.serviceStatusId,
      url: photo.url,
      at: photo.createdAt,
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

/** The order vanished between the request and the write — thrown inside a transaction so it rolls
 *  back and answers a plain `404` (the products-detail stance: malformed and unknown look alike). */
export class OrderNotFoundError extends Error {
  constructor() {
    super("order not found");
    this.name = "OrderNotFoundError";
  }
}

// The logistics-event conflict ("we can't be there") lives in `logistics/` — it is a rule about a
// DRIVER's day, not about goods, and mixing it with the stock conflict above is the single easiest
// way to make both confusing. See `OrderDriverConflictError` / `OrderSelfOverlapError`.

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
 * The `orders.turnaroundMinutes` app preference — the WASHING period after a collection — parsed
 * with the same defensive stance. Zero is a legitimate value here (a business with no cleaning step
 * between rentals), which is why it accepts `>= 0` where spacing demands `> 0`.
 */
export function parseTurnaroundMinutes(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : appConfig.defaultTurnaroundMinutes;
}

/** The two clock rules every booking decision reads: how far apart logistics events must be, and
 *  how long goods are being washed after they come back. */
export interface OrderTimingPreferencesModel {
  spacingMinutes: number;
  turnaroundMinutes: number;
}

/**
 * Reads both timing preferences in ONE query. Every flow that decides whether a booking is possible
 * — create, edit, and the availability probe — goes through here rather than reaching for
 * `app_preferences` itself, so the two rules can never be read with different defaults or forgotten
 * in one path (the turnaround was, for a while: seeded and honoured nowhere).
 */
export async function loadOrderTimingPreferences(
  client: Pick<Prisma.TransactionClient, "appPreference">,
): Promise<OrderTimingPreferencesModel> {
  const rows = await client.appPreference.findMany({
    where: {
      key: { in: ["orders.logisticsSpacingMinutes", "orders.turnaroundMinutes"] },
    },
    select: { key: true, value: true },
  });
  const valueOf = (key: string): string | undefined =>
    rows.find((row) => row.key === key)?.value;
  return {
    spacingMinutes: parseSpacingMinutes(valueOf("orders.logisticsSpacingMinutes")),
    turnaroundMinutes: parseTurnaroundMinutes(valueOf("orders.turnaroundMinutes")),
  };
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
 *
 * **The window a hold occupies is the billed period PLUS the washing turnaround.** Units come back
 * dirty: they are not available the instant an event's billed period ends, they are available once
 * they have been cleaned. Without this, two future orders could be promised the same chairs with a
 * ten-minute gap — the check would pass and the business would fail (owner rule, 2026-07-29).
 * `turnaroundMinutes` comes from the `orders.turnaroundMinutes` preference, so an operation with no
 * cleaning step sets it to 0 and gets the old behaviour exactly.
 *
 * `excludeServiceId` drops ONE order from the count — what an EDIT needs, since the order being
 * re-checked is still holding its own current lines and would otherwise conflict with itself.
 */
export interface RentedWindowOptions {
  /** The washing period after a collection, from `orders.turnaroundMinutes`. */
  turnaroundMinutes: number;
  /** Drop ONE order from the count (an edit re-checking itself). */
  excludeServiceId?: number;
}

// The trailing options are an OBJECT, not two more positional arguments: they are both numbers, and
// the day `turnaroundMinutes` was added positionally an existing call silently passed its order id
// as the turnaround and still type-checked. Named at every call site, that cannot happen.
export function buildRentedInWindowWhere(
  productIds: number[],
  windowStart: Date,
  windowEnd: Date,
  holding: { out: number[]; window: number[] },
  { turnaroundMinutes, excludeServiceId }: RentedWindowOptions,
): Prisma.ServiceDetailWhereInput {
  // Applied to the REQUESTED window's start rather than to every held row's end — mathematically
  // the same comparison (`heldEnd + turnaround > start` ⇔ `heldEnd > start − turnaround`), but this
  // way it stays a plain column comparison the index can serve.
  const clearedBy = new Date(windowStart.getTime() - turnaroundMinutes * 60 * 1000);
  return {
    productId: { in: productIds },
    isActive: true,
    isRental: true,
    service: {
      isActive: true,
      cancelledAt: null,
      ...(excludeServiceId !== undefined && { id: { not: excludeServiceId } }),
      OR: [
        { serviceStatusId: { in: holding.out } },
        {
          serviceStatusId: { in: holding.window },
          serviceStart: { lt: windowEnd },
          serviceEnd: { gt: clearedBy },
        },
      ],
    },
  };
}

// The logistics-event conflict rule used to live here as `buildSpacingConflictWhere` — a GLOBAL
// "N minutes between any two events anywhere" filter with no owner, which silently assumed one van.
// It now lives in `logistics/` as a per-DRIVER rule (`buildDriverConflictWhere` + `refineConflicts`),
// numerically identical today and additive for vehicles, trips and distance-aware gaps. Read
// `EPIC-2-DRIVER-AVAILABILITY.md` before touching it, and never reintroduce a global variant here.

// ── Stock across the lifecycle ───────────────────────────────────────────────────────────────────

/** One active line, as the stock rules need it. */
export interface StockLineModel {
  productId: number;
  quantity: number;
  isRental: boolean;
}

/**
 * **The two inventories, and why only one of them is written.**
 *
 * RENTAL units are never counted in a column: availability is DERIVED from the order's status via
 * `inventoryHold` (`buildRentedNowWhere`/`buildRentedInWindowWhere`). Cancelling or finishing an
 * order therefore frees its units the instant the status changes — no write, and nothing that can
 * drift. Rewinding re-takes them just as automatically.
 *
 * SALE units are the opposite: `products.quantity` is really decremented when the order is created,
 * because a sold item leaves the business. That decrement has to be un-done and re-done by hand at
 * exactly the points where the order stops or resumes being real — which is what these two helpers
 * are for. Completion is deliberately NOT one of those points: a delivered sale stays sold.
 */
/**
 * Is this order still HOLDING its sale units — i.e. would giving them back put real goods on the
 * shelf, or invent them?
 *
 * A sale unit is held from creation (when it's decremented, reserved for this client) until the
 * order is **delivered** — at that moment it physically leaves the business and is simply sold. So:
 * - not cancelled, not delivered → the order is holding them: stopping it gives them back;
 * - already cancelled → they were given back then; giving them again would invent stock;
 * - already delivered → the client HAS them; nothing can put them back on the shelf, and deleting
 *   the paperwork certainly can't.
 *
 * The same predicate answers cancel, reopen and delete, which is why it lives in one place.
 */
export const holdsSaleStock = (order: {
  cancelledAt: Date | null;
  deliveredAt: Date | null;
}): boolean => order.cancelledAt === null && order.deliveredAt === null;

export async function releaseSaleStock(
  tx: Prisma.TransactionClient,
  lines: readonly StockLineModel[],
): Promise<void> {
  await Promise.all(
    lines
      .filter((line) => !line.isRental)
      .map((line) =>
        tx.product.update({
          where: { id: line.productId },
          data: { quantity: { increment: line.quantity } },
        }),
      ),
  );
}

/**
 * Re-takes what an order needs when it comes BACK to life (reopening a cancelled one) — and refuses
 * if the business has since promised those goods to somebody else.
 *
 * Both inventories are checked, under a row lock on the products so two concurrent reopens can't
 * both pass: rentals against the order's own billed window (the units it would hold again), sales
 * against what is left on the shelf. A shortfall raises the same structured `409` the create flow
 * uses, naming each line and its real count — because "you can't reopen this" is useless without
 * "…because there are only 3 chairs left that weekend".
 */
export async function reclaimOrderStock(
  tx: Prisma.TransactionClient,
  order: {
    id: number;
    serviceStart: Date;
    serviceEnd: Date;
    lines: readonly StockLineModel[];
  },
  holding: { out: number[]; window: number[] },
  turnaroundMinutes: number,
): Promise<void> {
  if (order.lines.length === 0) {
    return;
  }
  const productIds = order.lines.map((line) => line.productId);
  await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE`;
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    select: { id: true, name: true, quantity: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  // What the FLEET already owes in this order's window. The order itself is still cancelled at this
  // point, so its own lines aren't counted — no self-exclusion needed.
  const rentalIds = order.lines.filter((line) => line.isRental).map((line) => line.productId);
  const rentedRows =
    rentalIds.length > 0
      ? await tx.serviceDetail.groupBy({
          by: ["productId"],
          where: buildRentedInWindowWhere(
            rentalIds,
            order.serviceStart,
            order.serviceEnd,
            holding,
            { turnaroundMinutes },
          ),
          _sum: { quantity: true },
        })
      : [];
  const rentedByProduct = new Map(
    rentedRows.map((row) => [row.productId, row._sum.quantity ?? 0]),
  );

  const conflicts: OrderStockConflictItemModel[] = [];
  for (const line of order.lines) {
    const product = productById.get(line.productId);
    if (!product) {
      // The product was deleted while the order sat cancelled — it can't come back as it was.
      conflicts.push({
        productId: line.productId,
        productName: `#${line.productId}`,
        requested: line.quantity,
        available: 0,
      });
      continue;
    }
    const available = line.isRental
      ? Math.max(0, product.quantity - (rentedByProduct.get(line.productId) ?? 0))
      : product.quantity;
    if (available < line.quantity) {
      conflicts.push({
        productId: product.id,
        productName: product.name,
        requested: line.quantity,
        available,
      });
    }
  }
  if (conflicts.length > 0) {
    throw new OrderStockConflictError(conflicts);
  }

  // Only sales move a number; the rental hold returns on its own with the status.
  await Promise.all(
    order.lines
      .filter((line) => !line.isRental)
      .map((line) =>
        tx.product.update({
          where: { id: line.productId },
          data: { quantity: { decrement: line.quantity } },
        }),
      ),
  );
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
