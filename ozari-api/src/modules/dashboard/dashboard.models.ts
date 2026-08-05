import type { LogisticsEventKindModel } from "../orders/logistics/logistics.models.js";
import type { OrderListItemResponseModel } from "../orders/orders.models.js";

/** A half-open instant range `[from, to)` — every period on this screen is expressed this way, so
 *  an order sitting exactly on a boundary belongs to one month and never to both. */
export interface DateRangeModel {
  from: Date;
  to: Date;
}

/**
 * One of the THREE things the admin has to care about next.
 *
 * It is an ORDER, represented by the single event it still has to perform — never a flat list of
 * events. An order with a delivery at 14:00 and a collection at 14:30 occupies ONE slot showing the
 * delivery; the moment that delivery is confirmed the same order re-enters the queue carrying its
 * collection, and re-sorts against everyone else by that new time. That is what makes the list
 * answer "what do I do now, then next, then after that" instead of listing the same job twice.
 *
 * It extends the ORDER LIST item deliberately: `actions` therefore comes from the lifecycle engine
 * already narrowed to this actor, so the quick action here and the one on the agenda can never
 * disagree about what is allowed.
 */
export interface UpNextItemResponseModel extends OrderListItemResponseModel {
  /** The event this slot is about — which physical trip, and when it is due. */
  event: {
    kind: LogisticsEventKindModel;
    at: Date;
    /** Its time has passed and it still has not happened. The one thing on this screen that is
     *  genuinely wrong rather than merely upcoming. */
    isOverdue: boolean;
    /** Whole minutes until `at` (negative once overdue) — computed server-side against the same
     *  `generatedAt` the rest of the payload uses, so every relative label on the screen agrees. */
    minutesUntil: number;
  };
  /** Where to go, decrypted. `deliveryCoords` is INHERITED from the list item — the lean list now
   *  carries the pin too, so every surface reads it from one projection. */
  deliveryAddress: string;
  /** How to get IN once you are there — the one delivery field the driver reads on arrival. */
  deliveryInstructions?: string;
  deliveryContact: string;
}

/** A money/volume figure for a period, paired with the same figure for the period before it. A
 *  number without its predecessor is trivia; with it, it is a direction. */
export interface StatComparisonModel {
  current: number;
  previous: number;
  /** Percentage change, or ABSENT when `previous` is 0 — "+∞%" and "+100%" are both lies about a
   *  month that started from nothing, so the client renders "sin comparación" instead. */
  deltaPercent?: number;
}

/** One bucket of the trailing-months revenue series. */
export interface RevenuePointModel {
  /** `YYYY-MM` — a stable machine key; the client formats the visible label in its own locale. */
  month: string;
  revenue: number;
  orders: number;
}

/** A product ranked by how much of it actually went out in the period. */
export interface TopProductModel {
  productId: number;
  name: string;
  quantity: number;
  revenue: number;
}

/** How many live orders sit in each lifecycle status — the "what is in flight" split. */
export interface StatusSliceModel {
  statusId: number;
  name: string;
  colorKey?: string;
  count: number;
}

export interface DashboardCurrencyModel {
  id: number;
  iso4217Code: string;
  name: string;
  symbol: string;
}

/**
 * The whole admin dashboard in ONE response. Deliberately one call rather than six: every figure
 * here is a snapshot of the same instant (`generatedAt`), so the screen can never show a revenue
 * total from one moment beside a counter from another — and a dashboard that fans out into six
 * requests pays six cold-start round trips on a scale-to-zero backend.
 */
export interface DashboardResponseModel {
  /** The instant every figure below was computed at. The client's "actualizado hace…" and every
   *  countdown derive from this, never from the browser clock, so a skewed device still agrees with
   *  the server about what is overdue. */
  generatedAt: Date;
  upNext: UpNextItemResponseModel[];
  today: {
    deliveries: number;
    collections: number;
    /** Pending events whose time has already passed. */
    overdue: number;
    /** Orders neither finished nor cancelled — the real "open work" number. */
    active: number;
  };
  month: {
    period: DateRangeModel;
    revenue: StatComparisonModel;
    orders: StatComparisonModel;
    averageOrder: StatComparisonModel;
    /** Orders CANCELLED this month (scoped by delivery date, like every figure here). Excluded from
     *  `revenue`/`orders` by the LIVE filter — counted separately because a cancellation is the one
     *  number on this screen that reports work LOST rather than done. */
    cancelled: StatComparisonModel;
  };
  /** Money on orders that have gone out and are not marked paid — the number a small business
   *  actually chases. */
  outstanding: {
    amount: number;
    orders: number;
  };
  revenueTrend: RevenuePointModel[];
  topProducts: TopProductModel[];
  statusSplit: StatusSliceModel[];
  currency: DashboardCurrencyModel;
}

export interface DashboardEnvelopeModel {
  dashboard: DashboardResponseModel;
}
