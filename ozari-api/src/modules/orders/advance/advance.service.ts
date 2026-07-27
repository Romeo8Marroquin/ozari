import type { Prisma } from "@prisma/client";
import { TrackedEventEnum } from "@models/enums/serviceLifecycleEnum.js";
import type {
  LifecycleOrderModel,
  StatusDefinitionModel,
  TransitionKindModel,
} from "../lifecycle/lifecycle.models.js";
import { isComplete } from "../lifecycle/lifecycle.service.js";

/**
 * The PURE half of a lifecycle transition: given the machine, the order and the move, what exactly
 * changes on the `services` row. Kept out of the controller so the stamping rules — the part a
 * misplaced `??` would silently corrupt — are unit-testable without a database.
 */

/** The order couldn't be advanced. `kind` maps to the HTTP answer: `notFound` → 404, `forbidden` →
 *  403 (the move is real, this actor may not make it), `invalid` → 409 (not a legal move at all),
 *  `evidence` → 422 (the step's photo requirement isn't met). */
export type AdvanceFailureKind =
  | "notFound"
  | "forbidden"
  | "invalid"
  | "evidence";

export class AdvanceOrderError extends Error {
  constructor(
    readonly kind: AdvanceFailureKind,
    readonly detail?: Record<string, unknown>,
  ) {
    super(`order advance rejected: ${kind}`);
    this.name = "AdvanceOrderError";
  }
}

/**
 * The tracked-actual + completion columns a transition writes, derived from the FLAGS — never from a
 * status id or a pipeline position:
 *
 * - **forward** — entering a step stamps the actual it declares (`tracksEvent`: DELIVERY →
 *   `deliveredAt`, COLLECTION → `collectedAt`) if it isn't stamped yet, and stamps `readyAt` when the
 *   move completes the order's applicable pipeline (a purchase-only order therefore finishes at
 *   Entregado, a rental at Listo — no sale-vs-rental branch anywhere).
 * - **backward** — the mirror image: LEAVING a step clears the actual that step stamped, and the
 *   order is no longer complete, so `readyAt` clears too. Rewinding is an admin correcting a mistaken
 *   tap; leaving a stale timestamp behind would poison the agenda's next-action sort.
 * - **disruptive** — stamps `cancelledAt` + the reason and leaves the actuals alone: history keeps
 *   WHERE the order was when it was cancelled (the status trail records the step itself).
 *
 * `now` is injected so tests can freeze the clock.
 */
export interface TransitionInputModel {
  catalog: StatusDefinitionModel[];
  order: LifecycleOrderModel;
  /** The status being LEFT (undefined when the order pointed at a row that no longer exists). */
  from: StatusDefinitionModel | undefined;
  to: StatusDefinitionModel;
  kind: TransitionKindModel;
  /** Injected so tests can freeze the clock. */
  now: Date;
  reason?: string;
}

export function buildTransitionData({
  catalog,
  order,
  from,
  to,
  kind,
  now,
  reason,
}: TransitionInputModel): Prisma.ServiceUpdateInput {
  const base: Prisma.ServiceUpdateInput = {
    serviceStatus: { connect: { id: to.id } },
  };
  if (kind === "disruptive") {
    return { ...base, cancelledAt: now, cancelReason: reason ?? null };
  }
  if (kind === "backward") {
    return {
      ...base,
      ...clearActual(from),
      // It cannot be finished any more — the pipeline has a step ahead of it again.
      readyAt: null,
    };
  }
  const moved: LifecycleOrderModel = { ...order, serviceStatusId: to.id };
  return {
    ...base,
    ...stampActual(to, now),
    ...(isComplete(catalog, moved) ? { readyAt: now } : {}),
  };
}

/** The actual a step stamps when entered. */
const stampActual = (
  status: StatusDefinitionModel,
  now: Date,
): Prisma.ServiceUpdateInput => {
  if (status.tracksEvent === TrackedEventEnum.DELIVERY) {
    return { deliveredAt: now };
  }
  return status.tracksEvent === TrackedEventEnum.COLLECTION
    ? { collectedAt: now }
    : {};
};

/** The actual a step clears when left (the rewind mirror of {@link stampActual}). */
const clearActual = (
  status: StatusDefinitionModel | undefined,
): Prisma.ServiceUpdateInput => {
  if (status?.tracksEvent === TrackedEventEnum.DELIVERY) {
    return { deliveredAt: null };
  }
  return status?.tracksEvent === TrackedEventEnum.COLLECTION
    ? { collectedAt: null }
    : {};
};

/**
 * Whether the submitted photos satisfy the step being ENTERED. Only a forward move can demand them
 * (rewinding/cancelling is never blocked by a camera), and the count must sit inside the status'
 * resolved bounds — too few is a missing requirement, too many is an upload the gallery can't show.
 */
export function assertEvidenceSatisfies(
  to: StatusDefinitionModel,
  kind: TransitionKindModel,
  bounds: { min: number; max: number },
  evidenceKeys: string[],
): void {
  const required = kind === "forward" && to.requiresEvidence;
  if (required && evidenceKeys.length < bounds.min) {
    throw new AdvanceOrderError("evidence", {
      required: bounds.min,
      received: evidenceKeys.length,
    });
  }
  if (evidenceKeys.length > bounds.max) {
    throw new AdvanceOrderError("evidence", {
      max: bounds.max,
      received: evidenceKeys.length,
    });
  }
}
