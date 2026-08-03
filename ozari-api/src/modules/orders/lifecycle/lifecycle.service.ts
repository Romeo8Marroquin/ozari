import { appConfig } from "@/config/app.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  InventoryHoldEnum,
  StatusAppliesToEnum,
  TrackedEventEnum,
} from "@models/enums/serviceLifecycleEnum.js";
import type {
  ActorContextModel,
  EvidenceBoundsModel,
  InventoryEffectModel,
  InventoryHoldingsModel,
  LifecycleOrderModel,
  OrderActionModel,
  OrderModeModel,
  StatusDefinitionModel,
  TransitionKindModel,
  TransitionSetModel,
} from "./lifecycle.models.js";

/**
 * THE ORDER LIFECYCLE ENGINE — the one place that decides what an order can become and who may
 * move it (EPIC-2 order lifecycle, 2026-07-27).
 *
 * The machine itself lives in DATA (`service_status` rows declare their position, inventory effect,
 * evidence rule, tracked actual, mode and colour); this module keeps only what data can't express:
 * the derivations over that vocabulary and the actor permission matrix. **Every** flow — the admin's
 * agenda tap, a driver's advance, a future client self-cancel, an auto-assign job, per-status
 * notifications — calls THESE functions with a different actor. Adding a flow is a new caller, never
 * a new machine, and no runtime code anywhere may branch on a literal status id.
 *
 * Everything here except {@link getStatusCatalog}/{@link getEvidenceBounds} is PURE: the caller
 * passes the catalog it already loaded, so projections stay query-free.
 */

// ── The catalog (cached vocabulary) ──────────────────────────────────────────────────────────────

/** The whole `service_status` table, memoized in-process with the moment it was read. */
let catalogCache: StatusDefinitionModel[] | null = null;
let catalogReadAt = 0;

/** Drop the memoized catalog. Called by EVERY admin write to the status definitions (and by tests). */
export function invalidateStatusCatalog(): void {
  catalogCache = null;
}

/** A DB string column → its enum, falling back to the safest value. The columns are plain text (no
 *  DB enum, per the repo's lookup style), so a hand-edited row can never crash the engine: an
 *  unknown hold means "holds nothing", an unknown mode means "applies to everything". */
const toInventoryHold = (value: string): InventoryHoldEnum =>
  Object.values(InventoryHoldEnum).find((hold) => hold === value) ??
  InventoryHoldEnum.NONE;

const toAppliesTo = (value: string): StatusAppliesToEnum =>
  Object.values(StatusAppliesToEnum).find((mode) => mode === value) ??
  StatusAppliesToEnum.ALL;

const toTrackedEvent = (value: string | null): TrackedEventEnum | null =>
  Object.values(TrackedEventEnum).find((event) => event === value) ?? null;

/** The `service_status` columns the engine reads — the Prisma `select` and the mapper's input. */
export const statusDefinitionSelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  sortOrder: true,
  isInitial: true,
  isDisruptive: true,
  inventoryHold: true,
  requiresEvidence: true,
  minEvidence: true,
  maxEvidence: true,
  appliesTo: true,
  tracksEvent: true,
  colorKey: true,
} as const;

/** Maps a raw `service_status` row to the engine's {@link StatusDefinitionModel}. */
export function toStatusDefinition(row: {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number | null;
  isInitial: boolean;
  isDisruptive: boolean;
  inventoryHold: string;
  requiresEvidence: boolean;
  minEvidence: number | null;
  maxEvidence: number | null;
  appliesTo: string;
  tracksEvent: string | null;
  colorKey: string | null;
}): StatusDefinitionModel {
  return {
    ...row,
    inventoryHold: toInventoryHold(row.inventoryHold),
    appliesTo: toAppliesTo(row.appliesTo),
    tracksEvent: toTrackedEvent(row.tracksEvent),
  };
}

/**
 * The status vocabulary — ALL rows, including inactive ones (an order may still sit in a status the
 * admin has since unpublished, and it must keep behaving per its flags). Memoized so reads never
 * re-query per request, with a **`statusCatalogTtlSeconds` expiry**: admin edits invalidate the
 * cache explicitly, but a `pnpm db:seed`, a hand-edited row, or an edit made on ANOTHER Cloud Run
 * instance cannot — and a process serving a machine that no longer exists silently loses the whole
 * lifecycle (no pipeline ⇒ no next step ⇒ no quick action). The TTL bounds every such staleness.
 */
export async function getStatusCatalog(): Promise<StatusDefinitionModel[]> {
  const now = Date.now();
  if (
    catalogCache !== null &&
    now - catalogReadAt < appConfig.statusCatalogTtlSeconds * 1000
  ) {
    return catalogCache;
  }
  const prismaClient = await getPrismaClient();
  const rows = await prismaClient.serviceStatus.findMany({
    orderBy: { id: "asc" },
    select: statusDefinitionSelect,
  });
  catalogCache = rows.map(toStatusDefinition);
  catalogReadAt = now;
  return catalogCache;
}

// ── Pure derivations over the catalog ────────────────────────────────────────────────────────────

/** A status by id, or `undefined` when the order points at a row that no longer exists. */
export function statusById(
  catalog: StatusDefinitionModel[],
  id: number,
): StatusDefinitionModel | undefined {
  return catalog.find((status) => status.id === id);
}

/** A status that actually occupies a pipeline slot — `sortOrder` narrowed to a number, so the
 *  ordering maths below never needs a "what if it's null" fallback. */
type PipelineStepModel = StatusDefinitionModel & { sortOrder: number };

/** Every ACTIVE pipeline step, in order — the happy path as currently configured. */
export function pipeline(catalog: StatusDefinitionModel[]): PipelineStepModel[] {
  return catalog
    .filter(
      (status): status is PipelineStepModel =>
        status.isActive && !status.isDisruptive && status.sortOrder !== null,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** An order is a RENTAL when any line is rented, else a purchase-only SALE. */
export const orderMode = (order: LifecycleOrderModel): OrderModeModel =>
  order.isRental ? "RENTAL" : "SALE";

/**
 * The pipeline THIS order actually walks: steps whose `appliesTo` matches its mode. A purchase-only
 * order simply never sees the RENTAL-only collection/listo steps, which is exactly how mode-aware
 * completion stays data-driven — no sale-vs-rental branch exists in code.
 */
export function applicablePipeline(
  catalog: StatusDefinitionModel[],
  mode: OrderModeModel,
): PipelineStepModel[] {
  return pipeline(catalog).filter(
    (status) =>
      status.appliesTo === StatusAppliesToEnum.ALL ||
      status.appliesTo === mode,
  );
}

/** The create-time status (the `isInitial` row), falling back to the first pipeline step. */
export function initialStatus(
  catalog: StatusDefinitionModel[],
): StatusDefinitionModel | null {
  const flagged = catalog.find(
    (status) => status.isActive && status.isInitial && !status.isDisruptive,
  );
  return flagged ?? pipeline(catalog)[0] ?? null;
}

/** The ACTIVE any-time exits (Cancelado today) — reachable from any pipeline step. */
export function disruptiveStates(
  catalog: StatusDefinitionModel[],
): StatusDefinitionModel[] {
  return catalog.filter((status) => status.isActive && status.isDisruptive);
}

/**
 * The status ids that hold rental units, split by HOW they hold — the single source the availability
 * queries (`buildRentedNowWhere`, `buildRentedInWindowWhere`) read:
 * - `out` — held unconditionally (on the truck, at the event, or awaiting washing);
 * - `window` — held only while the requested moment/window overlaps the order's billed period.
 *
 * Deliberately computed over the WHOLE catalog (inactive rows included): unpublishing a status must
 * never silently free units an order is still holding.
 */
export function holdingStatusIds(catalog: StatusDefinitionModel[]): {
  out: number[];
  window: number[];
} {
  return {
    out: catalog
      .filter((status) => status.inventoryHold === InventoryHoldEnum.OUT)
      .map((status) => status.id),
    window: catalog
      .filter((status) => status.inventoryHold === InventoryHoldEnum.WINDOW)
      .map((status) => status.id),
  };
}

// ── Inventory: what an order reserves, and what a move does to it ────────────────────────────────

/** Does sitting in this status reserve rental units at all? `NONE` is the only "no" — WINDOW and OUT
 *  differ in WHEN the units are unavailable, never in WHETHER they're held. A status that vanished
 *  from the catalog is treated as holding nothing (the availability queries can't see it either). */
const statusHoldsRental = (status: StatusDefinitionModel | undefined): boolean =>
  (status?.inventoryHold ?? InventoryHoldEnum.NONE) !== InventoryHoldEnum.NONE;

/**
 * What the order reserves RIGHT NOW.
 *
 * Rental units are derived from the current status' `inventoryHold` — so an order that has walked
 * past every holding step (washed and back on the shelf) reserves nothing, even though it is neither
 * cancelled nor deleted. Sale units are the real decrement, standing from creation until the order is
 * cancelled or delivered (mirrors `holdsSaleStock`).
 */
export function currentHoldings(
  catalog: StatusDefinitionModel[],
  order: LifecycleOrderModel,
): InventoryHoldingsModel {
  const cancelled = order.cancelledAt !== null;
  return {
    rental:
      order.isRental &&
      !cancelled &&
      statusHoldsRental(statusById(catalog, order.serviceStatusId)),
    sale: order.isSale && !cancelled && order.deliveredAt === null,
  };
}

/**
 * What the order would reserve once `toStatus` is applied.
 *
 * The rental side follows the target status' flag, always. The sale side moves only where the order
 * stops or resumes being real — a cancel gives the units back, a reopen takes them again (unless
 * they were already delivered, in which case the client has them and nothing can) — because a sale is
 * decremented at CREATION, not at delivery: walking the pipeline forwards or backwards never changes
 * the count.
 */
export function holdingsAfter(
  catalog: StatusDefinitionModel[],
  order: LifecycleOrderModel,
  toStatus: StatusDefinitionModel,
  kind: TransitionKindModel,
): InventoryHoldingsModel {
  if (kind === "disruptive") {
    return { rental: false, sale: false };
  }
  const rental = order.isRental && statusHoldsRental(toStatus);
  return {
    rental,
    sale:
      kind === "reopen"
        ? order.isSale && order.deliveredAt === null
        : currentHoldings(catalog, order).sale,
  };
}

/**
 * The one answer every confirm dialog states: does this move give goods back, take them again, or
 * leave the reservation alone? Derived entirely from the flags, so inserting a step, renaming one or
 * changing its `inventoryHold` rewrites the copy with no code change — and "cancel an order that
 * already finished" correctly promises nothing, because such an order holds nothing to give back.
 */
export function inventoryEffectOf(
  catalog: StatusDefinitionModel[],
  order: LifecycleOrderModel,
  toStatus: StatusDefinitionModel,
  kind: TransitionKindModel,
): InventoryEffectModel {
  const before = currentHoldings(catalog, order);
  const after = holdingsAfter(catalog, order, toStatus, kind);
  // `reclaim` is checked first because it is the effect that can FAIL — if a move both freed and
  // took, the availability risk is the thing the person must be told about.
  if ((!before.rental && after.rental) || (!before.sale && after.sale)) {
    return "reclaim";
  }
  return (before.rental && !after.rental) || (before.sale && !after.sale)
    ? "release"
    : "none";
}

/**
 * The order's NEXT applicable pipeline step, or `null` when it sits at its last one (⇒ complete) or
 * took a disruptive exit. This is the whole "what's the next tap" question, answered from data.
 */
export function nextStatus(
  catalog: StatusDefinitionModel[],
  order: LifecycleOrderModel,
): StatusDefinitionModel | null {
  const position = statusById(catalog, order.serviceStatusId)?.sortOrder;
  // No position ⇒ the status vanished or is a disruptive off-ramp; a cancelled order is final.
  if (position === undefined || position === null || order.cancelledAt !== null) {
    return null;
  }
  return (
    applicablePipeline(catalog, orderMode(order)).find(
      (status) => status.sortOrder > position,
    ) ?? null
  );
}

/** The order's PREVIOUS applicable pipeline step (the admin's rewind), or `null` at the start. */
export function previousStatus(
  catalog: StatusDefinitionModel[],
  order: LifecycleOrderModel,
): StatusDefinitionModel | null {
  const position = statusById(catalog, order.serviceStatusId)?.sortOrder;
  if (position === undefined || position === null || order.cancelledAt !== null) {
    return null;
  }
  const earlier = applicablePipeline(catalog, orderMode(order)).filter(
    (status) => status.sortOrder < position,
  );
  return earlier[earlier.length - 1] ?? null;
}

/** True once the order has walked its last applicable step (what stamps `services.readyAt`). A
 *  cancelled order is finished but NOT complete — it never reached the end of the pipeline. */
export function isComplete(
  catalog: StatusDefinitionModel[],
  order: LifecycleOrderModel,
): boolean {
  const current = statusById(catalog, order.serviceStatusId);
  if (!current || current.isDisruptive || order.cancelledAt !== null) {
    return false;
  }
  return nextStatus(catalog, order) === null;
}

// ── Permissions — the ONE matrix every flow reuses ───────────────────────────────────────────────

/**
 * Everything `actor` may do to `order` right now.
 *
 * | Actor | Forward | Backward | Disruptive (cancel) | Scope |
 * |-------|---------|----------|---------------------|-------|
 * | **Admin** | ✅ | ✅ | ✅ | every order |
 * | **Driver** | ✅ | ❌ | ✅ *(with a reason — owner decision 2026-07-27)* | only orders assigned to them |
 * | **Client** *(future)* | ❌ | ❌ | ✅ within the event-type edit window | own orders |
 * | **System** *(future)* | policy-scoped | ❌ | policy-scoped | — |
 *
 * A driver gets the field autonomy to report a failed delivery, but never to REWIND history —
 * correcting a mistaken tap stays the admin's call. A cancelled order offers nothing (a disruptive
 * exit is final; reopening one is deliberately not a transition).
 */
export function resolveTransitions(
  catalog: StatusDefinitionModel[],
  order: LifecycleOrderModel,
  actor: ActorContextModel,
): TransitionSetModel {
  const current = statusById(catalog, order.serviceStatusId);
  const finished = order.cancelledAt !== null || current?.isDisruptive === true;
  const isAdmin = actor.role === RolesEnum.Admin;
  const isAssignedDriver =
    actor.role === RolesEnum.Driver && order.assignedUserId === actor.userId;
  if (finished || !(isAdmin || isAssignedDriver)) {
    return { forward: null, backward: null, disruptive: [] };
  }
  return {
    forward: nextStatus(catalog, order),
    backward: isAdmin ? previousStatus(catalog, order) : null,
    disruptive: disruptiveStates(catalog),
  };
}

/**
 * The ordered steps that take `order` from where it is to `toStatus`, or `null` when this actor may
 * not make that move at all. **Every entry is a legal single transition**, so a multi-step jump is
 * exactly a sequence of the moves the matrix already permits — never a bypass of it.
 *
 * - **one step** — the ordinary forward tap / admin rewind / cancel: a one-entry path;
 * - **several steps** — the ADMIN-only jump (Pendiente → Listo, or Listo back to En ruta). Each entry
 *   is applied in turn, so each writes its own history row, stamps its own actual and (backwards)
 *   drops its own evidence. The trail records what really happened: a jump, step by step, now;
 * - **reopening a cancelled order** — admin-only, and deliberately NOT a pipeline walk: a cancelled
 *   order sits outside the pipeline, so it is placed directly back on the chosen step (a one-entry
 *   path) with its cancellation cleared.
 *
 * A driver is confined to what {@link resolveTransitions} already grants them — one forward step, or
 * an off-ramp — so a hand-written multi-step request from a driver resolves to `null`.
 */
// A decision TABLE read top to bottom — each branch is one sentence of the doc above.
// eslint-disable-next-line complexity -- splitting it would hide the order the rules apply in
export function resolveStatusPath(
  catalog: StatusDefinitionModel[],
  order: LifecycleOrderModel,
  toStatus: StatusDefinitionModel,
  actor: ActorContextModel,
): StatusDefinitionModel[] | null {
  if (!toStatus.isActive) {
    return null;
  }
  const isAdmin = actor.role === RolesEnum.Admin;

  // A cancelled order: only an admin may bring it back, and only onto a real pipeline step.
  if (order.cancelledAt !== null || statusById(catalog, order.serviceStatusId)?.isDisruptive) {
    const reopenable =
      isAdmin &&
      !toStatus.isDisruptive &&
      applicablePipeline(catalog, orderMode(order)).some(
        (status) => status.id === toStatus.id,
      );
    return reopenable ? [toStatus] : null;
  }

  // A single legal move (any actor) — the common path.
  if (transitionKindFor(catalog, order, toStatus, actor)) {
    return [toStatus];
  }
  if (!isAdmin || toStatus.isDisruptive) {
    return null;
  }

  // A multi-step walk along the order's OWN applicable pipeline (admin only).
  const steps = applicablePipeline(catalog, orderMode(order));
  const from = statusById(catalog, order.serviceStatusId)?.sortOrder;
  const target = toStatus.sortOrder;
  if (from === undefined || from === null || target === null) {
    return null;
  }
  const between =
    target > from
      ? steps.filter((step) => step.sortOrder > from && step.sortOrder <= target)
      : steps
          .filter((step) => step.sortOrder >= target && step.sortOrder < from)
          .reverse();
  // The target must be ON the order's applicable pipeline — a SALE order can never be walked to a
  // rental-only step, however hard the request asks.
  return between.length > 0 && between[between.length - 1]?.id === toStatus.id
    ? between
    : null;
}

/**
 * WHICH kind of move `toStatus` would be for this actor, or `null` when it isn't allowed at all —
 * **the single authority** every mutating flow asserts against (the advance endpoint re-checks it
 * under the row lock, so a permission can never be decided by the client).
 */
export function transitionKindFor(
  catalog: StatusDefinitionModel[],
  order: LifecycleOrderModel,
  toStatus: StatusDefinitionModel,
  actor: ActorContextModel,
): TransitionKindModel | null {
  if (!toStatus.isActive) {
    return null;
  }
  const allowed = resolveTransitions(catalog, order, actor);
  if (allowed.forward?.id === toStatus.id) {
    return "forward";
  }
  if (allowed.backward?.id === toStatus.id) {
    return "backward";
  }
  return allowed.disruptive.some((status) => status.id === toStatus.id)
    ? "disruptive"
    : null;
}

/** Boolean sugar over {@link transitionKindFor} for callers that only need a yes/no. */
export function canTransition(
  catalog: StatusDefinitionModel[],
  order: LifecycleOrderModel,
  toStatus: StatusDefinitionModel,
  actor: ActorContextModel,
): boolean {
  return transitionKindFor(catalog, order, toStatus, actor) !== null;
}

// ── Evidence bounds ──────────────────────────────────────────────────────────────────────────────

/** A `app_preferences` int value, parsed defensively (missing/corrupt ⇒ the seeded default). */
export function parseIntPreference(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The GLOBAL evidence bounds (`orders.evidenceMinPhotos` / `orders.evidenceMaxPhotos`): the range a
 * per-status count may be configured within, and the fallback for a status that sets neither. An
 * inverted pair (admin typo) collapses to `max = min` rather than making a step unsatisfiable.
 */
export async function getEvidenceBounds(): Promise<EvidenceBoundsModel> {
  const prismaClient = await getPrismaClient();
  const rows = await prismaClient.appPreference.findMany({
    where: {
      key: { in: ["orders.evidenceMinPhotos", "orders.evidenceMaxPhotos"] },
    },
    select: { key: true, value: true },
  });
  const valueOf = (key: string): string | undefined =>
    rows.find((row) => row.key === key)?.value;
  const min = parseIntPreference(
    valueOf("orders.evidenceMinPhotos"),
    appConfig.defaultEvidenceMinPhotos,
  );
  const max = parseIntPreference(
    valueOf("orders.evidenceMaxPhotos"),
    appConfig.defaultEvidenceMaxPhotos,
  );
  return { min, max: Math.max(min, max) };
}

/**
 * How many photos entering `status` demands: its own counts when set, else the global bounds —
 * always clamped INTO those bounds, so a stale per-status value can never demand more than the
 * uploader allows.
 */
export function evidenceBoundsFor(
  status: StatusDefinitionModel,
  globals: EvidenceBoundsModel,
): EvidenceBoundsModel {
  const min = Math.min(
    Math.max(status.minEvidence ?? globals.min, globals.min),
    globals.max,
  );
  const max = Math.min(
    Math.max(status.maxEvidence ?? globals.max, min),
    globals.max,
  );
  return { min, max };
}

// ── Projection helper ────────────────────────────────────────────────────────────────────────────

/**
 * The actor's allowed moves as the API projects them — the frontend renders its buttons straight
 * from this array (label, tone, whether to open the evidence uploader, whether to ask for a reason),
 * so no lifecycle knowledge is duplicated client-side.
 */
export function describeActions(
  catalog: StatusDefinitionModel[],
  order: LifecycleOrderModel,
  actor: ActorContextModel,
  globals: EvidenceBoundsModel,
): OrderActionModel[] {
  const allowed = resolveTransitions(catalog, order, actor);
  const describe = (
    status: StatusDefinitionModel,
    kind: TransitionKindModel,
  ): OrderActionModel => {
    // Only a FORWARD move can demand evidence: rewinding or cancelling must never be blocked by a
    // camera (the admin is undoing or aborting, not documenting a completed step).
    const requiresEvidence = kind === "forward" && status.requiresEvidence;
    const bounds = evidenceBoundsFor(status, globals);
    return {
      kind,
      statusId: status.id,
      statusName: status.name,
      colorKey: status.colorKey,
      requiresEvidence,
      minEvidence: bounds.min,
      maxEvidence: bounds.max,
      requiresReason: kind === "disruptive",
      inventoryEffect: inventoryEffectOf(catalog, order, status, kind),
      // Undoing a step deletes what documented it. Whether there ARE photos is a per-order fact, but
      // whether the step DEMANDED them is the machine's — and that is the same proxy the multi-step
      // dialog warns with, so the two never disagree.
      purgesEvidence:
        kind === "backward" &&
        statusById(catalog, order.serviceStatusId)?.requiresEvidence === true,
      // Forward only: rewinding or cancelling is desk work, and a "navigate there" button on either
      // would be offering a trip nobody is about to make.
      tracksEvent: kind === "forward" ? status.tracksEvent : null,
    };
  };
  return [
    ...(allowed.forward ? [describe(allowed.forward, "forward")] : []),
    ...(allowed.backward ? [describe(allowed.backward, "backward")] : []),
    ...allowed.disruptive.map((status) => describe(status, "disruptive")),
  ];
}
