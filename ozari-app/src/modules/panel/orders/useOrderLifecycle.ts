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

/** {@link splitOrderActions} memoized per order — the component-facing entry point. */
export default function useOrderLifecycle(order: OrderListItem): OrderLifecycle {
  return useMemo(() => splitOrderActions(order.actions), [order.actions]);
}
