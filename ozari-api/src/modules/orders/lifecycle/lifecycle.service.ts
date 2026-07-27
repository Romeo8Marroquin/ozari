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

/** The whole `service_status` table, memoized in-process. Definitions change only when the admin
 *  edits them (Phase 4), which invalidates this — so reads never re-query per request. */
let catalogCache: StatusDefinitionModel[] | null = null;

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
 * admin has since unpublished, and it must keep behaving per its flags). Memoized; every caller
 * derives from this array instead of querying.
 */
export async function getStatusCatalog(): Promise<StatusDefinitionModel[]> {
  if (catalogCache !== null) {
    return catalogCache;
  }
  const prismaClient = await getPrismaClient();
  const rows = await prismaClient.serviceStatus.findMany({
    orderBy: { id: "asc" },
    select: statusDefinitionSelect,
  });
  catalogCache = rows.map(toStatusDefinition);
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
    };
  };
  return [
    ...(allowed.forward ? [describe(allowed.forward, "forward")] : []),
    ...(allowed.backward ? [describe(allowed.backward, "backward")] : []),
    ...allowed.disruptive.map((status) => describe(status, "disruptive")),
  ];
}
