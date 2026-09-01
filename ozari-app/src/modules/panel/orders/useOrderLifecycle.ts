import { useMemo } from 'react';
import type { OrderAction, OrderListItem } from './order.types';

/** The moves available on an order, split by kind — what the UI actually renders. */
export interface OrderLifecycle {
  /** The next pipeline step, when this user may take it. */
  forward?: OrderAction;
  /** The rewind (admin only). */
  backward?: OrderAction;
  /** The any-time exits (cancel). */
  disruptive: OrderAction[];
  /** True when there is nothing this user can do to this order right now. */
  isIdle: boolean;
}

/**
 * Splits the backend's `actions` array into the shapes the UI renders — the FRONTEND MIRROR of the
 * lifecycle engine's `resolveTransitions`, and deliberately nothing more: it re-derives no rules.
 * Permission, order, evidence and reason requirements were all decided server-side (and are
 * re-validated there on every advance), so this hook can never disagree with the machine, and a
 * renamed/reordered/added status needs no frontend change.
 */
export function splitOrderActions(actions: OrderAction[]): OrderLifecycle {
  const forward = actions.find((action) => action.kind === 'forward');
  const backward = actions.find((action) => action.kind === 'backward');
  const disruptive = actions.filter((action) => action.kind === 'disruptive');
  return {
    ...(forward ? { forward } : {}),
    ...(backward ? { backward } : {}),
    disruptive,
    isIdle: actions.length === 0,
  };
}

/**
 * Does the actor's next move put somebody ON THE ROAD? That — not "the order is unfinished" — is
 * when a navigation button belongs beside it, and it is the ONE rule the ticket, the dashboard card
 * and the order detail all read, so the same order can never offer directions on one screen and
 * withhold them on another.
 *
 * It comes straight from the machine: `tracksEvent` is set on the steps that CONFIRM an arrival, so
 * an order sitting at *En ruta* (next: Entregado, `DELIVERY`) and one at *Entregado* with a pickup
 * still owed (next: Recolectado, `COLLECTION`) both get it, while *Pendiente* (next: En ruta — the
 * loading, which nobody drives to), *Recolectado* (next: Listo — the washing), a finished order and
 * a cancelled one get nothing. A rewind or a cancel never travels, so only the forward move can
 * qualify. Insert a status that tracks an event and the button follows it with no change here.
 *
 * The rule this REPLACES was "the order still has a trip somewhere in its future", which offered
 * directions on every pending order in the agenda — including ones scheduled for next week, and
 * next to a step whose whole job is to say the van has not left yet (owner, 2026-08-30).
 */
export function isTravelStep(action: OrderAction | undefined): boolean {
  return action?.tracksEvent != null;
}

/** {@link splitOrderActions} memoized per order — the component-facing entry point. */
export default function useOrderLifecycle(order: OrderListItem): OrderLifecycle {
  return useMemo(() => splitOrderActions(order.actions), [order.actions]);
}
