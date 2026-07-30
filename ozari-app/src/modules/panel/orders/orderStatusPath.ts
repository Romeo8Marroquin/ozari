import type {
  OrderDetail,
  OrderInventoryEffect,
  OrderStatusCatalogOption,
} from './order.types';

/**
 * The FRONTEND MIRROR of the backend's `resolveStatusPath` — used only to ask the admin for the
 * right things before submitting (which steps need photos, whether this is a reopen). The backend
 * re-resolves and re-validates the same path under a row lock, so this can never grant anything;
 * if the two ever disagree the server wins and the dialog shows its conflict.
 */

/** An order walks the steps that apply to its MODE: a purchase-only order never sees the
 *  rental-only ones (that is how it finishes at Entregado without a special case). */
export const isRentalOrder = (order: OrderDetail): boolean =>
  order.lines.some((line) => line.isRental);

/** A status that actually occupies a pipeline slot — `sortOrder` narrowed to a number, so the
 *  ordering maths below never needs a "what if it has no position" fallback. */
export type PipelineStep = OrderStatusCatalogOption & { sortOrder: number };

/** The pipeline this order actually walks, in order (disruptive off-ramps excluded). */
export function applicableSteps(
  statuses: OrderStatusCatalogOption[],
  order: OrderDetail,
): PipelineStep[] {
  const mode = isRentalOrder(order) ? 'RENTAL' : 'SALE';
  return statuses
    .filter(
      (status): status is PipelineStep =>
        !status.isDisruptive &&
        status.sortOrder !== undefined &&
        (status.appliesTo === 'ALL' || status.appliesTo === mode),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The off-ramps (Cancelado today) — an any-time exit, never a position. */
export const disruptiveSteps = (
  statuses: OrderStatusCatalogOption[],
): OrderStatusCatalogOption[] => statuses.filter((status) => status.isDisruptive);

/**
 * The ordered steps between where the order is and `target` — the walk the backend will apply:
 *
 * - a **cancelled** order is placed directly back on the chosen step (one entry: reopening isn't a
 *   walk, since a cancelled order sits outside the pipeline);
 * - forward or backward, every step in between is included, in the direction of travel, because each
 *   one really happens: its own history row, its own actual, its own photos;
 * - an empty array means there is nothing to do (the order is already there).
 */
export function stepsBetween(
  statuses: OrderStatusCatalogOption[],
  order: OrderDetail,
  target: OrderStatusCatalogOption,
): OrderStatusCatalogOption[] {
  if (order.cancelledAt !== undefined) {
    return target.isDisruptive ? [] : [target];
  }
  if (target.isDisruptive) {
    return [target];
  }
  const steps = applicableSteps(statuses, order);
  const from = steps.find((step) => step.id === order.status.id)?.sortOrder;
  const to = target.sortOrder;
  if (from === undefined || to === undefined || from === to) {
    return [];
  }
  return to > from
    ? steps.filter((step) => step.sortOrder > from && step.sortOrder <= to)
    : steps.filter((step) => step.sortOrder >= to && step.sortOrder < from).reverse();
}

/**
 * Which steps of a walk will DEMAND photos — only forward legs can (undoing or cancelling is never
 * blocked by a camera), and only while the order isn't being reopened onto a step it already passed.
 * The dialog collects all of them in one pass, which is what lets a jump be submitted at all.
 */
export function evidenceSteps(
  statuses: OrderStatusCatalogOption[],
  order: OrderDetail,
  target: OrderStatusCatalogOption,
): OrderStatusCatalogOption[] {
  if (order.cancelledAt !== undefined) return [];
  const walk = stepsBetween(statuses, order, target);
  const from = applicableSteps(statuses, order).find((step) => step.id === order.status.id);
  // A target with no position, or an order sitting outside its own pipeline, can't be "forward".
  const goingForward =
    target.sortOrder !== undefined &&
    from !== undefined &&
    target.sortOrder > from.sortOrder;
  return goingForward ? walk.filter((step) => step.requiresEvidence) : [];
}

/**
 * What a whole WALK does to the goods — the mirror of the backend's `inventoryEffectOf`, for the one
 * dialog the backend can't answer in advance (a jump has no single offered `OrderAction`).
 *
 * Only the ENDPOINTS matter: what the order reserves now, and what it will reserve once it lands on
 * `target`. Steps crossed in between never settle anything — a walk is applied in one transaction.
 *
 * The rental side follows each status' `inventoryHold`; the sale side only moves where the order
 * stops or resumes being real (cancel gives units back, a reopen takes them again unless they were
 * already delivered), because sale stock is decremented at CREATION, not at delivery.
 */
export function walkInventoryEffect(
  statuses: OrderStatusCatalogOption[],
  order: OrderDetail,
  target: OrderStatusCatalogOption,
): OrderInventoryEffect {
  const holdsRental = (step: OrderStatusCatalogOption | undefined): boolean =>
    (step?.inventoryHold ?? 'NONE') !== 'NONE';
  const hasRental = isRentalOrder(order);
  const hasSale = order.lines.some((line) => !line.isRental);
  const reopening = order.cancelledAt !== undefined;
  const current = statuses.find((step) => step.id === order.status.id);

  const before = {
    rental: hasRental && !reopening && holdsRental(current),
    sale: hasSale && !reopening && order.deliveredAt === undefined,
  };
  const after = {
    rental: hasRental && !target.isDisruptive && holdsRental(target),
    sale: reopening ? hasSale && order.deliveredAt === undefined : before.sale,
  };

  // `reclaim` wins a tie: it is the effect that can FAIL, so it is the one worth warning about.
  if ((!before.rental && after.rental) || (!before.sale && after.sale)) return 'reclaim';
  return (before.rental && !after.rental) || (before.sale && !after.sale) ? 'release' : 'none';
}

/** The steps whose photos a walk will DESTROY — every step being undone on a backward leg. */
export function purgedSteps(
  statuses: OrderStatusCatalogOption[],
  order: OrderDetail,
  target: OrderStatusCatalogOption,
): OrderStatusCatalogOption[] {
  if (order.cancelledAt !== undefined || target.isDisruptive) return [];
  const steps = applicableSteps(statuses, order);
  const from = steps.find((step) => step.id === order.status.id)?.sortOrder;
  const to = target.sortOrder;
  if (from === undefined || to === undefined || to >= from) return [];
  // Going back from `from` to `to` undoes every step in (to, from] — those are the ones whose
  // evidence goes with them.
  return steps.filter(
    (step) => step.sortOrder > to && step.sortOrder <= from && step.requiresEvidence,
  );
}
