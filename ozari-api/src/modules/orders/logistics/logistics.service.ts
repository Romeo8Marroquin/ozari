import { Prisma } from "@prisma/client";
import { decryptKms } from "@helpers/encryption.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import type { ActorContextModel } from "../lifecycle/lifecycle.models.js";
import type {
  ConflictCandidateModel,
  DriverAvailabilityModel,
  DriverConflictModel,
  DriverConflictOptionsModel,
  EventPadModel,
  LogisticsEventKindModel,
  LogisticsEventModel,
  OrderScheduleModel,
} from "./logistics.models.js";

const MINUTE_MS = 60 * 1000;

/**
 * An order's logistics events. **The single place that knows an order has events at all** — a
 * purchase-only order has just its delivery (Q-A), a rental adds its collection. Per-EVENT
 * assignment (delivery by driver A, collection by driver B — the fork in EPIC-2-ORDERS §6b) later
 * changes this function and nothing else.
 */
export function logisticsEvents(order: {
  deliveryAt: Date;
  // `Date | null | undefined` accepts BOTH shapes the codebase carries — a fetched row's nullable
  // column and a validated body's optional field — so no call site has to normalize first.
  pickupAt?: Date | null | undefined;
}): LogisticsEventModel[] {
  return [
    { at: order.deliveryAt, kind: "DELIVERY" as const },
    ...(order.pickupAt ? [{ at: order.pickupAt, kind: "COLLECTION" as const }] : []),
  ];
}

/**
 * **The OCCUPANCY rule (§4.5): an event occupies its driver's time from the moment it is scheduled
 * until the moment it actually HAPPENS — or never, if the order was cancelled.**
 *
 * One predicate, both directions, which is what makes the model coherent:
 * - the order being SAVED is checked only for the events it still has to perform, so editing a
 *   cancelled or finished order is pure paperwork and can never 409 (the same stance the stock
 *   rules already take through `holdsSaleStock` / `inventoryHold` — an order that reserves nothing
 *   is not competing with anyone);
 * - a CANDIDATE blocks only with the events it still has to perform, so a driver's completed
 *   morning does not reserve their afternoon.
 *
 * It reads the lifecycle's ACTUALS, never a status id — and rewinding a step clears the actual it
 * stamped (`advance.service.ts`), so a mistaken tap that is corrected re-occupies the day by
 * itself. A cancelled order short-circuits: nothing it lists will be performed.
 */
export function pendingLogisticsEvents(
  order: OrderScheduleModel,
): LogisticsEventModel[] {
  if (order.cancelledAt) {
    return [];
  }
  const happened: Record<LogisticsEventKindModel, boolean> = {
    DELIVERY: Boolean(order.deliveredAt),
    COLLECTION: Boolean(order.collectedAt),
  };
  return logisticsEvents(order).filter((event) => !happened[event.kind]);
}

/**
 * The events a save or a lifecycle move must be CHECKED against — the pending ones still ahead of
 * `now`.
 *
 * **The pad governs the future; the past is a record, not a schedule.** An overdue or historical
 * event still OCCUPIES its driver (candidates keep using {@link pendingLogisticsEvents}), but
 * refusing a write because two past events overlap would be a dead end: the admin cannot move time,
 * so there would be no way to correct the paperwork at all. This is what makes rewinding a
 * long-finished order — or reopening one whose dates have passed — always possible.
 *
 * The asymmetry is deliberate, and it reads correctly in the one case that matters: an order still
 * waiting on an overdue delivery blocks a NEW job an hour from now, because that work genuinely has
 * not been done yet.
 */
export function upcomingLogisticsEvents(
  order: OrderScheduleModel,
  now: Date,
): LogisticsEventModel[] {
  return pendingLogisticsEvents(order).filter((event) => event.at > now);
}

/**
 * How much of the driver's day one event occupies on each side of itself.
 *
 * Today: half the configured gap, both sides, for every event — so two events need the FULL gap
 * between them and the admin keeps thinking in "an hour between deliveries" rather than in pads
 * (owner decision §2.5: one setting, not two). The `event` argument is deliberately unused and
 * deliberately present: per-kind gaps ("delivering then collecting next door is cheaper"),
 * per-event-type gaps and travel-time-aware pads all arrive as changes to THIS body.
 *
 * Odd gaps round the PAD up, never the gap (§4.1): 45 minutes yields 23 per side, so the effective
 * distance is 46 — never less than what the admin asked for.
 */
export function padMinutesFor(
  _event: LogisticsEventModel,
  gapMinutes: number,
): EventPadModel {
  const half = Math.ceil(gapMinutes / 2);
  return { before: half, after: half };
}

/**
 * The widest pad ANY event can claim under this configuration — what the SQL must widen by for the
 * side of a pair it cannot see. Today every pad equals it; the day `padMinutesFor` varies, this
 * stays the ceiling and the over-selection is refined in code (§5).
 */
export function maxPadMinutes(gapMinutes: number): number {
  return Math.ceil(gapMinutes / 2);
}

/** Do two events' blocks overlap? Touching blocks do NOT (exclusive bounds — exactly the gap apart
 *  is allowed, which is what "minimum 1 hour BETWEEN" means). */
export function eventsOverlap(
  a: LogisticsEventModel,
  b: LogisticsEventModel,
  gapMinutes: number,
): boolean {
  const padA = padMinutesFor(a, gapMinutes);
  const padB = padMinutesFor(b, gapMinutes);
  const startA = a.at.getTime() - padA.before * MINUTE_MS;
  const endA = a.at.getTime() + padA.after * MINUTE_MS;
  const startB = b.at.getTime() - padB.before * MINUTE_MS;
  const endB = b.at.getTime() + padB.after * MINUTE_MS;
  return startA < endB && startB < endA;
}

/**
 * **Step 1 of the two-step rule (§5): SQL selects CANDIDATES with the MAXIMUM possible pad.**
 *
 * Today's spacing filter plus the thing that gives the rule an owner — `assignedUserId` — and
 * widened by `2 × maxPad` rather than by the gap itself, so it can never UNDER-select once pads
 * start varying. Cancelled orders are dropped here too: it is an exact column test, not a pad
 * approximation, so pruning it in SQL can never hide a row the code would have kept. Everything
 * else about WHICH events still occupy a day is decided by `pendingLogisticsEvents` inside
 * {@link refineConflicts} — one rule, one place.
 *
 * A pad that depends on the PAIR of events (travel time between two addresses) can never be one
 * clever `where` — which is exactly why this over-selects and {@link refineConflicts} decides.
 */
export function buildDriverConflictWhere(
  events: readonly LogisticsEventModel[],
  { gapMinutes, driverId, excludeServiceId }: DriverConflictOptionsModel,
): Prisma.ServiceWhereInput {
  const delta = maxPadMinutes(gapMinutes) * 2 * MINUTE_MS;
  const ranges = events.map((event) => ({
    gt: new Date(event.at.getTime() - delta),
    lt: new Date(event.at.getTime() + delta),
  }));
  return {
    isActive: true,
    cancelledAt: null,
    // The whole reframing, in one line: the day being filled belongs to a PERSON. A second driver
    // therefore does not block the first — which is the test that proves this epic did something.
    assignedUserId: driverId,
    ...(excludeServiceId !== undefined && { id: { not: excludeServiceId } }),
    OR: ranges.flatMap((range) => [{ deliveryAt: range }, { pickupAt: range }]),
  };
}

/**
 * **Step 2 of the two-step rule (§5): a PURE function decides which candidates actually conflict.**
 *
 * It takes the candidate ROWS (never ids) so a later `tripId` — events sharing one trip are exempt
 * — a vehicle, or a geo column becomes a filter right here instead of a new query. Today the SQL's
 * window and the pads agree, so it confirms what was selected and reports WHICH pair collided;
 * the moment `padMinutesFor` varies, this is the step that filters the over-selection.
 *
 * It is also where the OCCUPANCY rule lands on the blocking side: a candidate blocks with its
 * PENDING events only. That rule lives here rather than in the `where` deliberately — one place
 * decides what occupies a day, and the SQL is free to over-select (which it already does).
 */
export function refineConflicts(
  candidates: readonly ConflictCandidateModel[],
  events: readonly LogisticsEventModel[],
  gapMinutes: number,
): DriverConflictModel[] {
  const conflicts: DriverConflictModel[] = [];
  for (const candidate of candidates) {
    for (const theirs of pendingLogisticsEvents(candidate)) {
      for (const ours of events) {
        if (eventsOverlap(ours, theirs, gapMinutes)) {
          conflicts.push({
            orderId: candidate.id,
            at: theirs.at,
            kind: theirs.kind,
            blocks: ours.kind,
          });
        }
      }
    }
  }
  return conflicts;
}

/**
 * The order's OWN events, against each other — the hole this reframing exposed (§3.1): on create
 * the order isn't in the table yet, and on edit it is explicitly excluded, so a delivery at 14:00
 * with a collection at 14:15 saved happily. The same driver physically cannot do both. Pure, no
 * query, and it runs BEFORE the query so an impossible order never reaches the database.
 */
export function selfOverlap(
  events: readonly LogisticsEventModel[],
  gapMinutes: number,
): boolean {
  return events.some((event, index) =>
    events
      .slice(index + 1)
      .some((other) => eventsOverlap(event, other, gapMinutes)),
  );
}

/** The candidate SELECT — the raw event columns, the ACTUALS the occupancy rule reads, and the
 *  driver's encrypted name so a conflict can say WHO is already busy without a second query. */
const candidateSelect = {
  id: true,
  deliveryAt: true,
  pickupAt: true,
  deliveredAt: true,
  collectedAt: true,
  assignedUser: { select: { fullNameKms: true } },
} satisfies Prisma.ServiceSelect;

/**
 * The two steps run together: widen in SQL, refine in code. Returns every real overlap plus the
 * driver's decrypted name (all candidates share the driver — the `where` scopes by them).
 *
 * Both the availability PROBE and the transaction call this, so the answer the form was given and
 * the answer the save enforces can never come from two different rules.
 *
 * Nothing pending ⇒ nothing to ask: an order that will never be performed (cancelled) or has
 * already been performed occupies no day, so it takes no query at all — and an empty `OR` is never
 * handed to Prisma, where it would mean something else entirely.
 */
export async function findDriverConflicts(
  client: Pick<Prisma.TransactionClient, "service">,
  events: readonly LogisticsEventModel[],
  options: DriverConflictOptionsModel,
): Promise<{ conflicts: DriverConflictModel[]; driverName: string | undefined }> {
  if (events.length === 0) {
    return { conflicts: [], driverName: undefined };
  }
  const candidates = await client.service.findMany({
    where: buildDriverConflictWhere(events, options),
    select: candidateSelect,
  });
  const named = candidates
    .map((candidate) => candidate.assignedUser)
    .find((user) => user !== null);
  return {
    conflicts: refineConflicts(candidates, events, options.gapMinutes),
    driverName: named ? decryptKms(named.fullNameKms) : undefined,
  };
}

/** The order's own two events are closer than the configured gap — the §3.1 fix. A `409`, like
 *  every other "these values can't be saved" answer, and it names the gap so the copy can too. */
export class OrderSelfOverlapError extends Error {
  constructor(readonly gapMinutes: number) {
    super("order self overlap");
    this.name = "OrderSelfOverlapError";
  }
}

/**
 * The assigned driver already has an event whose block overlaps one of this order's — a `409`; the
 * admin is blocked exactly like a client would be (owner decision).
 *
 * It carries the WHOLE conflict (`{ orderId, at, kind, blocks }` + the driver's name + the gap),
 * not just a timestamp: EPIC-2-ORDERS §6b flagged the old thin payload, and a form that only knows
 * "something clashed" cannot put the error on the right date input or offer to open the other order.
 */
export class OrderDriverConflictError extends Error {
  constructor(
    readonly conflict: DriverConflictModel,
    readonly gapMinutes: number,
    readonly driverName: string | undefined,
  ) {
    super("order driver conflict");
    this.name = "OrderDriverConflictError";
  }
}

/**
 * The rule as the WRITE paths use it: refuse the order when its own events collide, or when the
 * assigned driver's day is already taken. Runs INSIDE the transaction, after the product locks and
 * before any write — the same position the old global spacing check occupied.
 *
 * Callers pass the order's PENDING events ({@link pendingLogisticsEvents}), never its raw ones, so
 * an edit of a cancelled or already-performed order asks nothing and refuses nothing.
 */
export async function assertDriverAvailable(
  client: Pick<Prisma.TransactionClient, "service">,
  events: readonly LogisticsEventModel[],
  options: DriverConflictOptionsModel,
): Promise<void> {
  if (selfOverlap(events, options.gapMinutes)) {
    throw new OrderSelfOverlapError(options.gapMinutes);
  }
  const { conflicts, driverName } = await findDriverConflicts(
    client,
    events,
    options,
  );
  const first = conflicts[0];
  if (first) {
    throw new OrderDriverConflictError(first, options.gapMinutes, driverName);
  }
}

/**
 * The ONE place the `driver` block of `POST /orders/availability` is shaped — the tiering rule
 * lives here so a future client-facing endpoint is a new branch rather than a new endpoint that
 * forgets it (§7).
 *
 * **Admin** runs the business and sees everything: which order, at what time, which of their own
 * events it blocks, and the configured gap so the copy quotes the real number. **Anyone else**
 * learns only whether the window can be served — never a name, a count, an order, or the fact that
 * the business has a single driver. Same doctrine as product-availability confidentiality.
 */
export function projectDriverAvailability(
  actor: Pick<ActorContextModel, "role">,
  input: {
    conflicts: readonly DriverConflictModel[];
    selfOverlap: boolean;
    gapMinutes: number;
    driverName?: string | undefined;
  },
): DriverAvailabilityModel {
  const available = input.conflicts.length === 0 && !input.selfOverlap;
  if (actor.role !== RolesEnum.Admin) {
    return { available };
  }
  return {
    available,
    gapMinutes: input.gapMinutes,
    selfOverlap: input.selfOverlap,
    conflicts: input.conflicts.map((conflict) => ({
      orderId: conflict.orderId,
      at: conflict.at,
      kind: conflict.kind,
      blocks: conflict.blocks,
    })),
    ...(input.driverName !== undefined && { driverName: input.driverName }),
  };
}
