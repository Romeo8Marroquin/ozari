/**
 * The vocabulary of the LOGISTICS PAD — the second cross-cutting engine of the orders module
 * (sibling to `lifecycle/`). Read `EPIC-2-DRIVER-AVAILABILITY.md` before changing anything here.
 *
 * The reframing this module exists for: the system no longer enforces "N minutes between any two
 * events anywhere in the business" (a global rule with no owner, silently assuming one van). It
 * enforces **"every logistics event OCCUPIES a block of its DRIVER's time, and two blocks on the
 * same driver may not overlap"**. Numerically identical today (±30 min ⇒ an hour apart); what
 * changes is that the rule now has a RESOURCE, which is what makes multi-driver, vehicles, trips
 * and distance-aware gaps additive instead of a rewrite.
 */

/** Which physical act an event is. The pad already takes the event, so a future "collecting is
 *  cheaper than delivering" rule is a change to `padMinutesFor`'s body, not to any call site. */
export type LogisticsEventKindModel = "DELIVERY" | "COLLECTION";

/** One thing a driver must physically be somewhere for. Derived from an order's `deliveryAt` /
 *  `pickupAt` by `logisticsEvents` — the ONE place that knows an order's events, so per-EVENT
 *  assignment (the fork recorded in EPIC-2-ORDERS §6b) later changes only that function. */
export interface LogisticsEventModel {
  at: Date;
  kind: LogisticsEventKindModel;
}

/** How much of the driver's day an event occupies on each side of its own instant, in minutes.
 *  Both numbers are half the configured gap today; the SHAPE is the door (see `padMinutesFor`). */
export interface EventPadModel {
  before: number;
  after: number;
}

/** What scopes a driver-conflict lookup: the configured gap, WHOSE day is being checked, and the
 *  one order to ignore (an edit is always within its own pad and can never conflict with itself). */
export interface DriverConflictOptionsModel {
  /** `orders.logisticsSpacingMinutes` — an admin preference, never a literal. */
  gapMinutes: number;
  /** The driver whose day the events would occupy. */
  driverId: number;
  /** Drop ONE order from the check (an edit re-checking itself). */
  excludeServiceId?: number;
}

/**
 * An order's schedule as the OCCUPANCY rule reads it: when each event is due, whether it has
 * already HAPPENED (the lifecycle's actuals), and whether the order was cancelled.
 *
 * The nullable/optional shapes accept BOTH callers without normalizing: a fetched row (columns are
 * `Date | null`) and a validated create body (no actuals at all, so the fields are simply absent).
 */
export interface OrderScheduleModel {
  deliveryAt: Date;
  // `Date | null | undefined` on every optional: a fetched row carries nulls, a validated body
  // carries `undefined`, and under `exactOptionalPropertyTypes` those are not the same type. Both
  // spellings mean the same thing here, so accept both rather than make call sites normalize.
  pickupAt?: Date | null | undefined;
  /** Stamped by the step that declares `tracksEvent: DELIVERY` — the delivery really happened. */
  deliveredAt?: Date | null | undefined;
  /** Stamped by the step that declares `tracksEvent: COLLECTION`. */
  collectedAt?: Date | null | undefined;
  /** Set = the order will never happen, so it occupies nobody's day. */
  cancelledAt?: Date | null | undefined;
}

/** A candidate row as the widened SQL returns it — deliberately the RAW columns, not ids, so a
 *  later `tripId`, vehicle or geo column becomes a filter inside `refineConflicts` rather than a
 *  new query (EPIC-2-DRIVER-AVAILABILITY §5). The actuals ride along because an event only occupies
 *  its driver until it has HAPPENED (§4.5). */
export interface ConflictCandidateModel extends OrderScheduleModel {
  id: number;
}

/** One real overlap: the OTHER order's event (`at`/`kind`) and WHICH of the checked order's own
 *  events it collides with (`blocks`) — so a form can put the error on the right date input
 *  instead of on both. */
export interface DriverConflictModel {
  orderId: number;
  at: Date;
  kind: LogisticsEventKindModel;
  blocks: LogisticsEventKindModel;
}

/** One conflict as the ADMIN tier of the availability probe publishes it (dates serialize to ISO
 *  strings over the wire). */
export interface DriverConflictItemModel {
  orderId: number;
  at: Date;
  kind: LogisticsEventKindModel;
  blocks: LogisticsEventKindModel;
}

/**
 * The `driver` block of `POST /orders/availability`, produced ONLY by `projectDriverAvailability`.
 *
 * Everything except `available` is **Admin tier**: a client asking whether their window can be
 * served learns that it can't and nothing else — no name, no count, no order, not even that the
 * business has a single driver (EPIC-2-DRIVER-AVAILABILITY §7). Keeping the tiers inside one
 * projection is what stops a future endpoint from forgetting the rule.
 */
export interface DriverAvailabilityModel {
  available: boolean;
  /** The configured gap, so the client formats copy from the real number instead of hardcoding
   *  "1 hora" — the admin can change it, and copy that lies about a setting is worse than none. */
  gapMinutes?: number;
  /** The order's OWN delivery and collection are too close together (§3.1 — never checked before,
   *  because on create the order isn't in the table yet and on edit it is excluded). */
  selfOverlap?: boolean;
  conflicts?: DriverConflictItemModel[];
  /** WHO is already busy. Sent even though the client picked the assignee itself, so the copy has
   *  ONE source: a form that names the driver from its own catalog would say something different
   *  from the `409` that follows, which reads as two different answers to the same question. */
  driverName?: string;
}
