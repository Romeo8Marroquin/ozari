import type { RolesEnum } from "@models/enums/rolesEnum.js";
import type {
  InventoryHoldEnum,
  StatusAppliesToEnum,
  TrackedEventEnum,
} from "@models/enums/serviceLifecycleEnum.js";

/**
 * One `service_status` row as the engine reads it — the DECLARED behavior of a lifecycle step. This
 * is the whole state machine's vocabulary: everything the engine decides (what's next, who may move
 * it, what it stamps, whether it holds units, how many photos it demands) comes from these fields,
 * never from an id.
 */
export interface StatusDefinitionModel {
  id: number;
  name: string;
  description: string | null;
  /** Publication flag: an inactive status can't be moved INTO, but orders already sitting in one
   *  keep behaving per its flags (it stays in the catalog so nothing is stranded). */
  isActive: boolean;
  /** Pipeline position; `null` = a disruptive off-ramp. */
  sortOrder: number | null;
  isInitial: boolean;
  isDisruptive: boolean;
  inventoryHold: InventoryHoldEnum;
  requiresEvidence: boolean;
  /** Per-status photo counts; `null` = inherit the global `orders.evidenceMin/MaxPhotos`. */
  minEvidence: number | null;
  maxEvidence: number | null;
  appliesTo: StatusAppliesToEnum;
  tracksEvent: TrackedEventEnum | null;
  colorKey: string | null;
}

/** An order is a RENTAL when ANY active line is rented, else a pure SALE (purchase-only). Drives
 *  mode-aware completion: `appliesTo` filters which pipeline steps that order actually walks. */
export type OrderModeModel = "RENTAL" | "SALE";

/**
 * The minimal order shape the engine reasons about — deliberately tiny so EVERY caller (list
 * projection, detail projection, the advance transaction, a future client/system flow) can build it
 * from whatever it already fetched, with no extra query.
 */
export interface LifecycleOrderModel {
  serviceStatusId: number;
  /** The driver the order is assigned to — the Driver actor's scope check. */
  assignedUserId: number | null;
  /** True when the order carries at least one rental line (`service_details.isRental`). */
  isRental: boolean;
  /** Set ⇒ the order took a disruptive exit and is final. */
  cancelledAt: Date | null;
}

/** WHO is attempting a transition. Extended (not replaced) as new flows land: a Client actor for
 *  self-service cancel, a System actor for jobs/auto-assign — each is a row in the permission
 *  matrix inside `canTransition`, never a second engine. */
export interface ActorContextModel {
  userId: number;
  role: RolesEnum;
}

/** The three shapes a move can take. `forward`/`backward` walk the pipeline; `disruptive` is the
 *  any-time exit (cancel), which is why it carries a reason. */
export type TransitionKindModel = "forward" | "backward" | "disruptive";

/**
 * Every move an actor may make on an order RIGHT NOW — the single answer both the API projection
 * and the UI render from. `forward`/`backward` are `null` when the pipeline has no such step OR the
 * actor isn't allowed it; `disruptive` lists only the off-ramps this actor may take.
 */
export interface TransitionSetModel {
  forward: StatusDefinitionModel | null;
  backward: StatusDefinitionModel | null;
  disruptive: StatusDefinitionModel[];
}

/**
 * One offered action, projected to the client: what it moves to, how it renders, and what the UI
 * must collect before calling `POST /orders/:id/advance` (photos and/or a reason). The frontend
 * builds its buttons from this array — no lifecycle knowledge is duplicated there.
 */
export interface OrderActionModel {
  kind: TransitionKindModel;
  statusId: number;
  statusName: string;
  colorKey: string | null;
  requiresEvidence: boolean;
  /** Resolved bounds (per-status override, else the global preference) — only meaningful when
   *  `requiresEvidence`. */
  minEvidence: number;
  maxEvidence: number;
  /** Disruptive moves ask for a reason (`services.cancelReason`). */
  requiresReason: boolean;
}

/** The global evidence bounds (from `app_preferences`, with `appConfig` fallbacks). */
export interface EvidenceBoundsModel {
  min: number;
  max: number;
}
