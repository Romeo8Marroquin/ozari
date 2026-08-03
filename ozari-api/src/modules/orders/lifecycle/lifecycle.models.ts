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
  /** True when it carries at least one SALE line. Independent of {@link isRental} (an order can be
   *  both): the two inventories are held and released by different rules. */
  isSale: boolean;
  /** Set ⇒ the order took a disruptive exit and is final. */
  cancelledAt: Date | null;
  /** Set ⇒ the goods physically left the business. Sale stock can never come back after this. */
  deliveredAt: Date | null;
}

/**
 * What a move does to the goods the order reserves — the ONLY thing the confirm dialogs' inventory
 * copy is allowed to claim, so it stays true as steps are added, renamed or re-flagged:
 * - `release` — units this order was holding go back to the fleet/shelf;
 * - `reclaim` — the order takes units again, so the move **can fail** on availability;
 * - `none` — the reservation is unchanged (finishing an order that already released, cancelling one
 *   that holds nothing, any step whose `inventoryHold` matches the one before it).
 */
export type InventoryEffectModel = "release" | "reclaim" | "none";

/** What an order reserves at a given moment, split by the two inventories (see `holdsSaleStock`). */
export interface InventoryHoldingsModel {
  /** Rental units, DERIVED from the status' `inventoryHold` — never a stored count. */
  rental: boolean;
  /** Sale units, a real decrement standing until the order is cancelled or delivered. */
  sale: boolean;
}

/** WHO is attempting a transition. Extended (not replaced) as new flows land: a Client actor for
 *  self-service cancel, a System actor for jobs/auto-assign — each is a row in the permission
 *  matrix inside `canTransition`, never a second engine. */
export interface ActorContextModel {
  userId: number;
  role: RolesEnum;
}

/**
 * The shapes a move can take. `forward`/`backward` walk the pipeline; `disruptive` is the any-time
 * exit (cancel), which is why it carries a reason; `reopen` is its admin-only undo — a cancelled
 * order placed back onto a real step, clearing the cancellation but keeping every actual it had
 * (those are facts, not state).
 */
export type TransitionKindModel =
  | "forward"
  | "backward"
  | "disruptive"
  | "reopen";

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
  /** What accepting this move does to the reserved goods — the dialog's inventory sentence. */
  inventoryEffect: InventoryEffectModel;
  /** True when accepting this move DESTROYS the photos of the step it undoes (a backward leg out of
   *  a step that demanded evidence). Warned about before it happens, never after. */
  purgesEvidence: boolean;
  /**
   * Which physical trip this move CONFIRMS, when it confirms one — read straight from the status's
   * `tracksEvent`, so "is somebody about to drive somewhere?" stays a property of the machine rather
   * than a list of status ids in the client. It is what puts a "navigate there" button beside the
   * advance action, and only on the steps where driving is what actually happens.
   *
   * Only a FORWARD move carries it: rewinding Entregado is an admin fixing a mistaken tap at a desk,
   * not a journey, and offering navigation there would be noise.
   */
  tracksEvent: TrackedEventEnum | null;
}

/** The global evidence bounds (from `app_preferences`, with `appConfig` fallbacks). */
export interface EvidenceBoundsModel {
  min: number;
  max: number;
}
