import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OrderAction, OrderListItem } from './order.types';
import useOrderLifecycle, { splitOrderActions } from './useOrderLifecycle';

const action = (overrides: Partial<OrderAction> & Pick<OrderAction, 'kind'>): OrderAction => ({
  statusId: 5,
  statusName: 'En ruta',
  requiresEvidence: false,
  minEvidence: 1,
  maxEvidence: 10,
  requiresReason: false,
  inventoryEffect: 'none',
  purgesEvidence: false,
  ...overrides,
});

const FORWARD = action({ kind: 'forward' });
const BACKWARD = action({ kind: 'backward', statusId: 1, statusName: 'Pendiente' });
const CANCEL = action({
  kind: 'disruptive',
  statusId: 2,
  statusName: 'Cancelado',
  requiresReason: true,
});

describe('splitOrderActions', () => {
  it('splits the offered moves by kind', () => {
    const lifecycle = splitOrderActions([FORWARD, BACKWARD, CANCEL]);
    expect(lifecycle.forward).toBe(FORWARD);
    expect(lifecycle.backward).toBe(BACKWARD);
    expect(lifecycle.disruptive).toEqual([CANCEL]);
    expect(lifecycle.isIdle).toBe(false);
  });

  it('omits what the backend did not offer', () => {
    // A driver gets forward + cancel, never a rewind — the frontend just reflects that.
    const lifecycle = splitOrderActions([FORWARD, CANCEL]);
    expect(lifecycle.forward).toBe(FORWARD);
    expect(lifecycle.backward).toBeUndefined();
    expect(lifecycle.disruptive).toEqual([CANCEL]);
  });

  it('an order with nothing available is idle', () => {
    expect(splitOrderActions([])).toEqual({ disruptive: [], isIdle: true });
  });

  it('carries multiple off-ramps through (a future "No entregado" needs no code change)', () => {
    const failed = action({ kind: 'disruptive', statusId: 8, statusName: 'No entregado' });
    expect(splitOrderActions([CANCEL, failed]).disruptive).toEqual([CANCEL, failed]);
  });
});

describe('useOrderLifecycle', () => {
  const order = (actions: OrderAction[]) => ({ actions }) as OrderListItem;

  it('holds the split stable while the actions are, and recomputes when they change', () => {
    const actions = [FORWARD];
    const { result, rerender } = renderHook(
      ({ item }: { item: OrderListItem }) => useOrderLifecycle(item),
      { initialProps: { item: order(actions) } },
    );
    const first = result.current;
    expect(first.forward?.statusName).toBe('En ruta');

    // A re-render carrying the SAME actions array reuses the memoized split…
    rerender({ item: order(actions) });
    expect(result.current).toBe(first);

    // …a refetch that changed them (the order advanced) produces a new one.
    rerender({ item: order([]) });
    expect(result.current.isIdle).toBe(true);
  });
});
