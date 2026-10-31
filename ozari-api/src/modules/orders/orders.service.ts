import { Prisma } from "@prisma/client";
import { appConfig } from "@/config/app.js";
import { decryptKms } from "@helpers/encryption.js";
import { decodeCoords } from "@helpers/geo.js";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { RentTimeUnitEnum } from "@models/enums/rentTimeUnitEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { TrackedEventEnum } from "@models/enums/serviceLifecycleEnum.js";
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
  OrderActionModel,
  StatusDefinitionModel,
} from "./lifecycle/lifecycle.models.js";
import {
  type OrderDepositCollectionResponseModel,
  type OrderDepositCollectionStatusModel,
  type OrderDepositSettlementResponseModel,
  type OrderDetailResponseModel,
  type OrderListItemResponseModel,
  type OrderSecurityDepositResponseModel,
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
  // The deposit snapshots ride along for `depositSettlementPending` — the agenda's pending-deposit
  // flag — and for the delivery action's `depositToCollect` (two small columns, no extra query; the
  // collection stamps are plain `services` columns and arrive with the row).
  serviceDetails: {
    where: { isActive: true },
    select: { quantity: true, isRental: true, securityDeposit: true, replacementPrice: true },
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
      securityDeposit: true,
      replacementPrice: true,
      damagedQuantity: true,
      damageNote: true,
      variantId: true,
      variantLabel: true,
      product: {
        select: {
          name: true,
          // ONE photo per line, never the gallery: the flagged primary, else the first by display
          // order — of the product's SHOWCASE set only (a value photo is the wrong colour for a line
          // of another variant). Read through `lineImageUrl`.
          productImages: {
            where: { optionValueId: null },
            orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
            take: 1,
            select: { url: true },
          },
        },
      },
      // The variation's photos come FIRST: each of its values (walked in option order by
      // `lineImageUrl`) with that value's primary, else its first photo.
      variant: {
        select: {
          values: {
            select: {
              optionValue: {
                select: {
                  option: { select: { sortOrder: true } },
                  images: {
                    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
                    take: 1,
                    select: { url: true },
                  },
                },
              },
            },
          },
        },
      },
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
  depositHistory: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      kind: true,
      note: true,
      depositTotal: true,
      claimsTotal: true,
      refundAmount: true,
      balanceDue: true,
      createdAt: true,
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
 * THE photo of an order line — the ONE place a line's `imageUrl` is decided (the detail page and
 * the printed documents' thumbnails read it). The VARIATION's photo first: its values walked in
 * option order, the first value with photos giving its primary (else its first). Then the product's
 * SHOWCASE primary, else its first (never `coverImageUrl`, which falls back to the DEFAULT variant —
 * the wrong colour for this line). None when neither exists: the row prints without one.
 */
export function lineImageUrl(
  line: Pick<RichOrder["serviceDetails"][number], "product" | "variant">,
): string | undefined {
  const variantImage = [...(line.variant?.values ?? [])]
    .sort((a, b) => a.optionValue.option.sortOrder - b.optionValue.option.sortOrder)
    .find((value) => value.optionValue.images.length > 0)?.optionValue.images[0]?.url;
  return variantImage ?? line.product.productImages[0]?.url;
}

/**
 * The identity of a LINE — a product without variants (`variantId` null) or one of its variants —
 * and, for every product that does not share its stock, of its STOCK POOL too. Order lines are
 * identified by it, and availability is counted per its pool (`poolKey`); one key shape for products
 * and orders so a map built by one is read by the other.
 */
export const stockKey = (productId: number, variantId: number | null | undefined): string =>
  `${productId}:${variantId ?? ""}`;

/**
 * The STOCK POOL a line draws from (owner 2026-10-30): its variant's own — unless the product
 * SHARES one pool across its variants (configurations of the same units), where every variant line
 * draws from the product's. Keyed like `stockKey`.
 */
export const poolKey = (
  product: { id: number; sharedStock: boolean },
  variantId: number | null,
): string => stockKey(product.id, product.sharedStock ? null : variantId);

/**
 * Sums `quantity` per stock POOL — rented rows grouped by line identity, a form's demand, an order's
 * held lines. A product absent from `productById` keeps the line's own identity.
 */
export function sumByPool(
  lines: ReadonlyArray<{ productId: number; variantId: number | null; quantity: number }>,
  productById: ReadonlyMap<number, { id: number; sharedStock: boolean }>,
): Map<string, number> {
  const sums = new Map<string, number>();
  for (const line of lines) {
    const product = productById.get(line.productId);
    const key = product ? poolKey(product, line.variantId) : stockKey(line.productId, line.variantId);
    sums.set(key, (sums.get(key) ?? 0) + line.quantity);
  }
  return sums;
}

/** A `groupBy(["productId","variantId"])` rented row as `sumByPool` reads it. */
export const rentedRowQuantity = (row: {
  productId: number;
  variantId: number | null;
  _sum: { quantity: number | null };
}): { productId: number; variantId: number | null; quantity: number } => ({
  productId: row.productId,
  variantId: row.variantId,
  quantity: row._sum.quantity ?? 0,
});

/** The separator between a variation's value names in its label. */
export const VARIANT_LABEL_SEPARATOR = " · ";

/**
 * A variation's label — its values' names in OPTION order, joined by " · " ("Rojo · Redondo"). The
 * one formatter for the products projection AND the order line snapshot.
 */
export function variantLabelOf(
  values: ReadonlyArray<{ optionValue: { name: string; option: { sortOrder: number } } }>,
): string {
  return [...values]
    .sort((a, b) => a.optionValue.option.sortOrder - b.optionValue.option.sortOrder)
    .map((value) => value.optionValue.name)
    .join(VARIANT_LABEL_SEPARATOR);
}

/**
 * The `service_details` filter selecting every line that HOLDS inventory on an open or future order
 * — whatever its window, unlike the "right now" / "in this window" availability rules: a RENTAL line
 * whose order sits on an `OUT` or `WINDOW` status, or a SALE line whose order still holds its stock
 * (`holdsSaleStock`: not delivered). Cancelled, finished (NONE) and inactive rows never hold.
 *
 * It answers "may this stock pool disappear?" — the products update refuses to remove a variant (409
 * `variantInUse`) or to switch a product between product-level and per-variant stock (409
 * `stockModeInUse`) while such lines exist, and reports `usage.holding` per variant.
 */
export function buildHoldingLinesWhere(holding: {
  out: number[];
  window: number[];
}): Prisma.ServiceDetailWhereInput {
  return {
    isActive: true,
    service: { isActive: true, cancelledAt: null },
    OR: [
      {
        isRental: true,
        service: { serviceStatusId: { in: [...holding.out, ...holding.window] } },
      },
      { isRental: false, service: { deliveredAt: null } },
    ],
  };
}

/** Round money HALF-UP to cents once, at the final multiplication. */
const roundMoney = (value: number): number => Math.round(value * 100) / 100;

// ── Security deposit & damage settlement (EPIC-2-ORDERS §12) ─────────────────────────────────────

/** A line as the deposit rules read it — the lean list row, the rich row and a freshly PRICED line
 *  (plain numbers, the order edit's re-check) all satisfy it. */
export interface DepositLineModel {
  isRental: boolean;
  quantity: number;
  securityDeposit: Prisma.Decimal | number | null;
  replacementPrice: Prisma.Decimal | number | null;
}

/**
 * Can this line take part in a settlement? Only RENTAL lines (a sold item never comes back to be
 * judged), and only when it carries a deposit or a replacement value — a rental line with neither
 * has nothing to retain and nothing to bill (owner 2026-10-27: the option does not even appear).
 */
export const isSettleableLine = (line: DepositLineModel): boolean =>
  line.isRental &&
  ((line.securityDeposit !== null && Number(line.securityDeposit) > 0) ||
    line.replacementPrice !== null);

/** The order's refundable deposit: Σ rental line snapshot × quantity. Never part of `totalAmount`. */
export const computeDepositTotal = (lines: readonly DepositLineModel[]): number =>
  roundMoney(
    lines
      .filter((line) => line.isRental)
      .reduce((sum, line) => sum + Number(line.securityDeposit ?? 0) * line.quantity, 0),
  );

/**
 * The settlement's derived money, in ONE place: everything claimed (retained for partial damage +
 * lost/broken units at their replacement value) is first taken from the deposit; what the deposit
 * does not need goes back to the client, and what it cannot cover is owed on top. The deposit is
 * expected to be lower than a replacement (that is the product rule), so a total loss typically
 * yields "nothing refunded, balance due".
 */
export function computeSettlementMoney(
  depositTotal: number,
  retainedAmount: number,
  damagesTotal: number,
): Pick<
  OrderDepositSettlementResponseModel,
  "claimsTotal" | "appliedFromDeposit" | "refundAmount" | "balanceDue"
> {
  const claimsTotal = roundMoney(retainedAmount + damagesTotal);
  const appliedFromDeposit = Math.min(depositTotal, claimsTotal);
  return {
    claimsTotal,
    appliedFromDeposit,
    refundAmount: roundMoney(depositTotal - appliedFromDeposit),
    balanceDue: roundMoney(Math.max(0, claimsTotal - depositTotal)),
  };
}

/** The order facts that decide whether a settlement is due/allowed. */
interface DepositOrderStateModel {
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  depositSettledAt: Date | null;
}

/** A settlement can be RECORDED once the goods were delivered (only then can anything come back
 *  damaged) and while the order is not cancelled. Whether it is due at all is `isSettleableLine`. */
export const canRecordSettlement = (order: DepositOrderStateModel): boolean =>
  order.deliveredAt !== null && order.cancelledAt === null;

/** The list flag: settleable, recordable, and not recorded yet. */
export const isDepositSettlementPending = (
  order: DepositOrderStateModel & { serviceDetails: readonly DepositLineModel[] },
): boolean =>
  order.depositSettledAt === null &&
  canRecordSettlement(order) &&
  order.serviceDetails.some(isSettleableLine);

// ── Deposit COLLECTION (was it actually received?) ───────────────────────────────────────────────

/** The two stamps that say whether the deposit was collected (mutually exclusive by construction). */
export interface DepositCollectionStampsModel {
  depositReceivedAt: Date | null;
  depositWaivedAt: Date | null;
}

/** PENDING until recorded; RECEIVED / WAIVED from whichever stamp is set. */
export const depositCollectionStatus = (
  order: DepositCollectionStampsModel,
): OrderDepositCollectionStatusModel => {
  if (order.depositReceivedAt !== null) {
    return "RECEIVED";
  }
  return order.depositWaivedAt !== null ? "WAIVED" : "PENDING";
};

/**
 * THE deposit a settlement counts — the one rule, in one place (owner 2026-10-28: only a deposit
 * actually RECEIVED is money we have): the nominal deposit when its collection is RECEIVED, 0 while
 * it is PENDING or WAIVED (there is nothing in hand to refund or apply; every claim is owed on top).
 * Every settlement figure, the history snapshot and the dashboard read it through here. The
 * retention CEILING is not this — it is the nominal `computeDepositTotal` (a retention is "that part
 * of the deposit", billed even when the deposit never reached us).
 */
export const heldDeposit = (
  order: Pick<DepositCollectionStampsModel, "depositReceivedAt"> & {
    serviceDetails: readonly DepositLineModel[];
  },
): number => (order.depositReceivedAt === null ? 0 : computeDepositTotal(order.serviceDetails));

/** May the collection be recorded / changed / cleared now: whenever the order is not cancelled —
 *  before OR after the damage report (owner 2026-10-28: a deposit received late is recorded on the
 *  detail; the report's money is computed live, so it simply follows). */
export const canRecordDepositCollection = (order: { cancelledAt: Date | null }): boolean =>
  order.cancelledAt === null;

/**
 * The nominal deposit still to be asked about at the delivery — or `undefined` when there is nothing
 * to ask: no deposit, already received/waived, cancelled, or a damage report already recorded (the
 * delivery dialog is a PRE-report question; after it, the collection is changed on the detail). The
 * delivery action's `depositToCollect` AND the advance's acceptance of `depositCollection` both read
 * it, so the dialog is offered exactly when the write would be applied.
 */
export const pendingDepositToCollect = (
  order: DepositCollectionStampsModel & {
    cancelledAt: Date | null;
    depositSettledAt: Date | null;
    serviceDetails: readonly DepositLineModel[];
  },
): number | undefined => {
  const total = computeDepositTotal(order.serviceDetails);
  return total > 0 &&
    depositCollectionStatus(order) === "PENDING" &&
    order.depositSettledAt === null &&
    canRecordDepositCollection(order)
    ? total
    : undefined;
};

/** Stamps `depositToCollect` on the forward move INTO a DELIVERY-tracking step when the order still
 *  has a deposit to confirm; every other action passes through untouched. */
export const withDepositToCollect = (
  actions: OrderActionModel[],
  toCollect: number | undefined,
): OrderActionModel[] =>
  toCollect === undefined
    ? actions
    : actions.map((action) =>
        action.kind === "forward" && action.tracksEvent === TrackedEventEnum.DELIVERY
          ? { ...action, depositToCollect: toCollect }
          : action,
      );

/** The detail's `collection` block — absent when there is no deposit to collect at all. */
export function projectDepositCollection(
  order: DepositCollectionStampsModel & {
    depositWaivedReason: string | null;
    cancelledAt: Date | null;
    depositSettledAt: Date | null;
  },
  total: number,
): OrderDepositCollectionResponseModel | undefined {
  if (total <= 0) {
    return undefined;
  }
  const status = depositCollectionStatus(order);
  return {
    status,
    at: order.depositReceivedAt ?? order.depositWaivedAt ?? undefined,
    reason: status === "WAIVED" ? (order.depositWaivedReason ?? undefined) : undefined,
    canRecord: canRecordDepositCollection(order),
  };
}

/**
 * Projects the detail's `securityDeposit` block, or `undefined` when no line can carry a deposit or
 * a damage (the section simply does not exist for that order).
 */
export function projectSecurityDeposit(order: RichOrder): OrderSecurityDepositResponseModel | undefined {
  if (!order.serviceDetails.some(isSettleableLine)) {
    return undefined;
  }
  const total = computeDepositTotal(order.serviceDetails);
  const held = heldDeposit(order);
  let settlement: OrderDepositSettlementResponseModel | undefined;
  if (order.depositSettledAt !== null) {
    const damages = order.serviceDetails
      .filter((line) => line.damagedQuantity > 0)
      .map((line) => {
        const unitAmount = Number(line.replacementPrice ?? 0);
        return {
          lineId: line.id,
          productName: line.product.name,
          variantId: line.variantId ?? undefined,
          variantLabel: line.variantLabel ?? undefined,
          quantity: line.damagedQuantity,
          unitAmount,
          amount: roundMoney(unitAmount * line.damagedQuantity),
          note: line.damageNote ?? undefined,
        };
      });
    const damagesTotal = roundMoney(damages.reduce((sum, damage) => sum + damage.amount, 0));
    const retainedAmount = Number(order.depositRetainedAmount ?? 0);
    settlement = {
      settledAt: order.depositSettledAt,
      retainedAmount,
      retainedReason: order.depositRetainedReason ?? undefined,
      damages,
      damagesTotal,
      ...computeSettlementMoney(held, retainedAmount, damagesTotal),
    };
  }
  return {
    total,
    held,
    collection: projectDepositCollection(order, total),
    canSettle: canRecordSettlement(order),
    settlement,
  };
}

/**
 * An order edit would break its recorded settlement — a damaged line dropped, reduced below its
 * damaged units or left without a replacement value, or the deposit shrunk below what was retained.
 * Thrown inside the edit transaction (rolls it back) → `409`: the admin undoes the settlement first.
 */
export class OrderSettlementConflictError extends Error {
  constructor() {
    super("order settlement conflict");
    this.name = "OrderSettlementConflictError";
  }
}

/**
 * Re-checks a recorded settlement against the order's NEW lines (an edit re-derives the deposit and
 * replacement snapshots from the products, exactly like the prices). `current` are the lines as they
 * stand (with their damage); `next` the re-priced final lines, matched by LINE KEY (product +
 * variant — `stockKey`), the same identity the edit reconciles lines by.
 */
export function assertSettlementSurvivesEdit(
  order: {
    depositSettledAt: Date | null;
    depositRetainedAmount: Prisma.Decimal | null;
    serviceDetails: ReadonlyArray<{
      productId: number;
      variantId: number | null;
      damagedQuantity: number;
    }>;
  },
  next: readonly PricedOrderLineModel[],
): void {
  const nextByKey = new Map(next.map((line) => [stockKey(line.productId, line.variantId), line]));
  for (const line of order.serviceDetails.filter((detail) => detail.damagedQuantity > 0)) {
    const kept = nextByKey.get(stockKey(line.productId, line.variantId));
    if (
      !kept?.isRental ||
      kept.replacementPrice === null ||
      kept.quantity < line.damagedQuantity
    ) {
      throw new OrderSettlementConflictError();
    }
  }
  if (order.depositSettledAt === null) {
    return;
  }
  // The retention ceiling is the NEW lines' NOMINAL deposit — the same ceiling the report itself
  // enforces (whether the deposit was received only decides what is refunded vs owed, live).
  if (Number(order.depositRetainedAmount ?? 0) > computeDepositTotal(next)) {
    throw new OrderSettlementConflictError();
  }
}

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
    // The engine's moves, plus the one ORDER fact the delivery dialog needs: the deposit still to
    // confirm ("¿Se recibió el depósito?") rides on the forward DELIVERY move only.
    actions: withDepositToCollect(
      describeActions(context.catalog, lifecycleOrder, context.actor, context.evidence),
      pendingDepositToCollect(order),
    ),
    // Does this order reserve anything at all right now? The delete dialog states the consequence
    // from THIS, never from a guess: a finished or cancelled order gave its goods back long ago, so
    // promising that deleting it "returns units to inventory" would simply be false.
    holdsInventory: holdings.rental || holdings.sale,
    paymentStatus: order.paymentStatus,
    // Is the money in? Derived from the ACTUAL (`paidAt`), not from a status id — the same stance
    // the lifecycle takes. It exists so the client can offer "Registrar pago" from a FACT instead of
    // comparing a lookup id, which is exactly how a dialog ends up guessing.
    isPaid: order.paidAt !== null,
    // The delivery PIN — the one delivery snapshot the lean list carries, so the agenda can offer
    // navigation on the same rule as the detail and the dashboard. The address TEXT deliberately
    // stays off the list (it is the PII-heavier half, and the detail is where it belongs); a maps
    // link works without it, opening on the coordinates rather than on a labelled place.
    // Same truthiness guard + total decode as the detail projection: an absent or unreadable pin
    // projects as "no pin" rather than reaching `decryptKms` or rendering a NaN.
    deliveryCoords: order.deliveryCoordsKms
      ? decodeCoords(decryptKms(order.deliveryCoordsKms))
      : undefined,
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
    depositSettlementPending: isDepositSettlementPending(order),
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
    deliveryInstructions: order.deliveryInstructionsKms
      ? decryptKms(order.deliveryInstructionsKms)
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
      variantId: line.variantId ?? undefined,
      variantLabel: line.variantLabel ?? undefined,
      imageUrl: lineImageUrl(line),
      isRental: line.isRental,
      quantity: line.quantity,
      unitaryPrice: Number(line.unitaryPrice),
      parcialPrice: Number(line.parcialPrice),
      securityDeposit: toMoney(line.securityDeposit),
      replacementPrice: toMoney(line.replacementPrice),
      damagedQuantity: line.damagedQuantity,
      damageNote: line.damageNote ?? undefined,
    })),
    extras: order.serviceExtras.map((extra) => ({
      id: extra.id,
      name: extra.name,
      description: extra.description ?? undefined,
      quantity: extra.quantity ?? undefined,
      unitaryPrice: toMoney(extra.unitaryPrice),
      parcialPrice: toMoney(extra.parcialPrice),
    })),
    securityDeposit: projectSecurityDeposit(order),
    statusHistory: order.statusHistory.map((entry) => ({
      id: entry.id,
      from: entry.fromStatus ?? undefined,
      to: entry.toStatus,
      byUserName: decryptKms(entry.byUser.fullNameKms),
      at: entry.createdAt,
    })),
    depositHistory: order.depositHistory.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      note: entry.note ?? undefined,
      depositTotal: toMoney(entry.depositTotal),
      claimsTotal: toMoney(entry.claimsTotal),
      refundAmount: toMoney(entry.refundAmount),
      balanceDue: toMoney(entry.balanceDue),
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

/** One active line, as the stock rules need it. `variantId` picks the stock POOL (null = the
 *  product's own); `variantLabel` is the line's snapshot, quoted when a retired variant conflicts. */
export interface StockLineModel {
  productId: number;
  variantId: number | null;
  variantLabel: string | null;
  quantity: number;
  isRental: boolean;
}

/**
 * Moves SALE stock by `delta` on the line's pool — the ONE writer of a sale decrement/restock: the
 * variant row's `quantity` when the line names a variant, else the product row's. A variant of a
 * SHARED-stock product draws from the product's one pool instead (`poolKey`): the two conditional
 * writes below let the stored mode decide, so no caller has to load it — exactly one of them
 * matches. Every caller holds the product row lock (`SELECT … FOR UPDATE` on `products`), which
 * serializes a variant's writers too — the products update takes the same row first.
 */
export function moveSaleStock(
  tx: Prisma.TransactionClient,
  line: { productId: number; variantId: number | null },
  delta: number,
): Promise<unknown> {
  const data = { quantity: { increment: delta } };
  return line.variantId !== null
    ? Promise.all([
        tx.productVariant.updateMany({
          where: { id: line.variantId, product: { sharedStock: false } },
          data,
        }),
        tx.product.updateMany({ where: { id: line.productId, sharedStock: true }, data }),
      ])
    : tx.product.update({ where: { id: line.productId }, data });
}

/** A line as the sale-delta reading needs it. */
type SaleDeltaLine = Pick<StockLineModel, "productId" | "variantId" | "quantity" | "isRental">;

/**
 * How many SALE units an order edit moves, per stock pool: + what the order held before (given
 * back), − what it takes now. A pool that left the order returns its whole quantity, a new one takes
 * its whole quantity, an unchanged one nets to zero and is dropped. Feed each entry to
 * `moveSaleStock` (only while the order still holds its sale stock).
 */
export function saleStockDeltas(
  current: readonly SaleDeltaLine[],
  next: readonly SaleDeltaLine[],
): { productId: number; variantId: number | null; delta: number }[] {
  const deltas = new Map<string, { productId: number; variantId: number | null; delta: number }>();
  const add = (line: SaleDeltaLine, delta: number): void => {
    const key = stockKey(line.productId, line.variantId);
    const entry = deltas.get(key) ?? { productId: line.productId, variantId: line.variantId, delta: 0 };
    entry.delta += delta;
    deltas.set(key, entry);
  };
  current.filter((line) => !line.isRental).forEach((line) => add(line, line.quantity));
  next.filter((line) => !line.isRental).forEach((line) => add(line, -line.quantity));
  return [...deltas.values()].filter((entry) => entry.delta !== 0);
}

/** The variation fields of a stock-conflict item — present only for a variant line. */
export const conflictVariantFields = (
  variantId: number | null,
  variantLabel: string | null,
): Pick<OrderStockConflictItemModel, "variantId" | "variantLabel"> => ({
  ...(variantId !== null && { variantId }),
  ...(variantLabel !== null && { variantLabel }),
});

/** A product row (under the lock) with its ACTIVE variants' stock — what availability reads. */
export interface StockPoolProductModel {
  id: number;
  quantity: number;
  /** One pool shared by every variant (`products.quantity`) — see `poolKey`. */
  sharedStock: boolean;
  variants: ReadonlyArray<{ id: number; quantity: number }>;
}

/**
 * The FLEET (rentals) or SHELF (sales) of one pool: the variant's own `quantity` for a variant line,
 * else the product's — also for a variant of a SHARED-stock product. `null` = the variant is no
 * longer ACTIVE on that product (retired or gone) — the callers answer it like a vanished product:
 * a stock conflict with `available: 0`.
 */
export function poolQuantity(
  product: StockPoolProductModel,
  variantId: number | null,
): number | null {
  if (variantId === null) {
    return product.quantity;
  }
  const variant = product.variants.find((candidate) => candidate.id === variantId);
  if (!variant) {
    return null;
  }
  return product.sharedStock ? product.quantity : variant.quantity;
}

/**
 * The conflict item for a short POOL. A shared pool names the PRODUCT (no variant fields — every
 * configuration competes for the same units) and reports what all its lines asked for together;
 * a variant's own pool names that variant, as before.
 */
export function poolConflictItem(
  product: { id: number; name: string; sharedStock: boolean },
  line: { variantId: number | null; variantLabel: string | null },
  requested: number,
  available: number,
): OrderStockConflictItemModel {
  return {
    productId: product.id,
    productName: product.name,
    ...(product.sharedStock ? {} : conflictVariantFields(line.variantId, line.variantLabel)),
    requested,
    available,
  };
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
      .map((line) => moveSaleStock(tx, line, line.quantity)),
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
    select: {
      id: true,
      name: true,
      quantity: true,
      sharedStock: true,
      variants: { where: { isActive: true }, select: { id: true, quantity: true } },
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  // What the FLEET already owes in this order's window, per stock pool. The order itself is still
  // cancelled at this point, so its own lines aren't counted — no self-exclusion needed.
  const rentalIds = order.lines.filter((line) => line.isRental).map((line) => line.productId);
  const rentedRows =
    rentalIds.length > 0
      ? await tx.serviceDetail.groupBy({
          by: ["productId", "variantId"],
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
  const rentedByPool = sumByPool(rentedRows.map(rentedRowQuantity), productById);
  // What the order asks of each POOL (lines of a shared-stock product compete for one pool).
  const requestedByPool = sumByPool(order.lines, productById);
  const checkedPools = new Set<string>();

  const conflicts: OrderStockConflictItemModel[] = [];
  for (const line of order.lines) {
    const product = productById.get(line.productId);
    // The product was deleted, or the VARIANT retired, while the order sat cancelled — it can't
    // come back as it was (a retired variant never holds anything, so nothing can be re-taken).
    const pool = product ? poolQuantity(product, line.variantId) : null;
    if (pool === null) {
      conflicts.push({
        productId: line.productId,
        productName: product?.name ?? `#${line.productId}`,
        ...conflictVariantFields(line.variantId, line.variantLabel),
        requested: line.quantity,
        available: 0,
      });
      continue;
    }
    const stockProduct = product as NonNullable<typeof product>;
    const key = poolKey(stockProduct, line.variantId);
    if (checkedPools.has(key)) {
      continue; // a shared pool is judged once, on everything its lines ask for together
    }
    checkedPools.add(key);
    // Every line was summed into its pool above — never absent.
    const requested = requestedByPool.get(key) as number;
    const available = line.isRental
      ? Math.max(0, pool - (rentedByPool.get(key) ?? 0))
      : pool;
    if (available < requested) {
      conflicts.push(poolConflictItem(stockProduct, line, requested, available));
    }
  }
  if (conflicts.length > 0) {
    throw new OrderStockConflictError(conflicts);
  }

  // Only sales move a number; the rental hold returns on its own with the status.
  await Promise.all(
    order.lines
      .filter((line) => !line.isRental)
      .map((line) => moveSaleStock(tx, line, -line.quantity)),
  );
}

/** An ACTIVE variant as the pricing reads it: its overrides (NULL = inherit) and its values for the
 *  label snapshot. */
export interface OrderPricingVariantModel {
  id: number;
  rentPrice: Prisma.Decimal | null;
  sellPrice: Prisma.Decimal | null;
  securityDeposit: Prisma.Decimal | null;
  replacementPrice: Prisma.Decimal | null;
  values: ReadonlyArray<{ optionValue: { name: string; option: { sortOrder: number } } }>;
}

/** A product row as the pricing needs it (fetched under the creation lock). */
export interface OrderPricingProductModel {
  id: number;
  name: string;
  productBusinessTypeId: number;
  rentTimeUnitId: number | null;
  rentPrice: Prisma.Decimal | null;
  sellPrice: Prisma.Decimal | null;
  securityDeposit: Prisma.Decimal | null;
  replacementPrice: Prisma.Decimal | null;
  /** ACTIVE variants only (`orderPricingProductSelect`). */
  variants: readonly OrderPricingVariantModel[];
}

/** One priced line, ready for the nested `service_details` create. */
export interface PricedOrderLineModel {
  productId: number;
  /** The stock pool — null for a product without variants. */
  variantId: number | null;
  /** The label SNAPSHOT ("Rojo · Redondo") — re-derived on every save; null without a variant. */
  variantLabel: string | null;
  quantity: number;
  isRental: boolean;
  unitaryPrice: number;
  parcialPrice: number;
  /** Per-unit snapshots (rental lines only; `null` otherwise) — see `ServiceDetail` in the schema. */
  securityDeposit: number | null;
  replacementPrice: number | null;
}

/** The `product` select every pricing caller locks and reads — one shape, so a new snapshot column
 *  can never be priced on create and forgotten on edit. */
export const orderPricingProductSelect = {
  id: true,
  name: true,
  quantity: true,
  sharedStock: true,
  currencyId: true,
  productBusinessTypeId: true,
  rentTimeUnitId: true,
  rentPrice: true,
  sellPrice: true,
  securityDeposit: true,
  replacementPrice: true,
  // Only ACTIVE variants can be ordered: a variant retired between validation and the lock is
  // simply absent here, and the caller answers it as a stock conflict with `available: 0`.
  variants: {
    where: { isActive: true },
    select: {
      id: true,
      quantity: true,
      rentPrice: true,
      sellPrice: true,
      securityDeposit: true,
      replacementPrice: true,
      values: {
        select: { optionValue: { select: { name: true, option: { select: { sortOrder: true } } } } },
      },
    },
  },
} satisfies Prisma.ProductSelect;

/** The snapshot columns a priced line writes on `service_details` (create and edit alike). The
 *  line's identity (`productId` + `variantId`) is written by the create only — a kept row keeps it. */
export const pricedLineData = (line: PricedOrderLineModel) => ({
  variantLabel: line.variantLabel,
  quantity: line.quantity,
  isRental: line.isRental,
  unitaryPrice: line.unitaryPrice,
  parcialPrice: line.parcialPrice,
  securityDeposit: line.securityDeposit,
  replacementPrice: line.replacementPrice,
});

/**
 * Prices one requested line from ITS PRODUCT ROW — the single place order money is derived; a
 * client-sent price is never trusted. Rental lines bill `rentPrice × qty × billedDays` when the
 * unit is **Día** and flat `rentPrice × qty` for **Evento** (duration-agnostic by definition);
 * sale lines bill `sellPrice × qty` once. Other rent units (Hora/Semana/Mes) are rejected upstream
 * by the validator — the MVP billing engine is day-based (owner: day is THE norm; the hourly door
 * stays open and gets real math when a product actually needs it, never silent wrong billing).
 * `null` = the product violates the conditional price rule (defensive; the validator checked).
 *
 * A line of a VARIATION (`variantId`) prices from the variant's EFFECTIVE values — each override,
 * else the product's — for the price, the deposit and the replacement alike, and snapshots its
 * label. `null` too when that variant is not an ACTIVE variant of the product (retired or gone under
 * the lock — the caller answers it as a stock conflict with `available: 0`).
 */
export function priceOrderLine(
  quantity: number,
  product: OrderPricingProductModel,
  billedDays: number,
  variantId: number | null = null,
): PricedOrderLineModel | null {
  const isRental = product.productBusinessTypeId === BusinessTypeEnum.RENT;
  const variant =
    variantId === null ? null : product.variants.find((candidate) => candidate.id === variantId);
  if (variant === undefined) {
    return null;
  }
  const effective = (
    field: "rentPrice" | "sellPrice" | "securityDeposit" | "replacementPrice",
  ): Prisma.Decimal | null => variant?.[field] ?? product[field];
  const unitPrice = isRental ? effective("rentPrice") : effective("sellPrice");
  if (unitPrice === null) {
    return null;
  }
  const unitaryPrice = Number(unitPrice);
  const multiplier =
    isRental && product.rentTimeUnitId === RentTimeUnitEnum.Dia ? billedDays : 1;
  // The deposit and the replacement value only mean something for goods that come BACK — a sale
  // line never carries them, even if the product's type changed since (the product rule forbids
  // them on Venta anyway).
  const rentalSnapshot = (value: Prisma.Decimal | null): number | null =>
    isRental && value !== null ? Number(value) : null;
  return {
    productId: product.id,
    variantId,
    variantLabel: variant ? variantLabelOf(variant.values) : null,
    quantity,
    isRental,
    unitaryPrice,
    parcialPrice: roundMoney(unitaryPrice * quantity * multiplier),
    securityDeposit: rentalSnapshot(effective("securityDeposit")),
    replacementPrice: rentalSnapshot(effective("replacementPrice")),
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
