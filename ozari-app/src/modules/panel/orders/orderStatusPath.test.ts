import { describe, expect, it } from 'vitest';
import type { OrderDetail, OrderStatusCatalogOption } from './order.types';
import {
  applicableSteps,
  disruptiveSteps,
  evidenceSteps,
  isRentalOrder,
  purgedSteps,
  stepsBetween,
  walkInventoryEffect,
} from './orderStatusPath';

/** The seeded machine, as `GET /orders/catalog` publishes it. */
const status = (
  overrides: Partial<OrderStatusCatalogOption> & Pick<OrderStatusCatalogOption, 'id' | 'name'>,
): OrderStatusCatalogOption => ({
  isInitial: false,
  isDisruptive: false,
  inventoryHold: 'NONE',
  requiresEvidence: false,
  minEvidence: 1,
  maxEvidence: 10,
  appliesTo: 'ALL',
  ...overrides,
});

// The seeded holds, exactly: Pendiente reserves the WINDOW, the three middle steps hold the units
// OUT (Recolectado included — there is a washing period), and only Listo returns them to the fleet.
const CATALOG: OrderStatusCatalogOption[] = [
  status({ id: 1, name: 'Pendiente', sortOrder: 1, isInitial: true, inventoryHold: 'WINDOW' }),
  status({ id: 5, name: 'En ruta', sortOrder: 2, inventoryHold: 'OUT' }),
  status({
    id: 3,
    name: 'Entregado',
    sortOrder: 3,
    requiresEvidence: true,
    inventoryHold: 'OUT',
  }),
  status({
    id: 4,
    name: 'Recolectado',
    sortOrder: 4,
    requiresEvidence: true,
    appliesTo: 'RENTAL',
    inventoryHold: 'OUT',
  }),
  status({ id: 6, name: 'Listo', sortOrder: 5, appliesTo: 'RENTAL' }),
  status({ id: 2, name: 'Cancelado', isDisruptive: true }),
];

const at = (id: number, name: string, over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    status: { id, name },
    lines: [{ isRental: true }],
    ...over,
  }) as OrderDetail;

const names = (steps: OrderStatusCatalogOption[]) => steps.map((step) => step.name);
const target = (id: number) => CATALOG.find((step) => step.id === id) as OrderStatusCatalogOption;

describe('applicableSteps', () => {
  it('gives a rental the whole pipeline and a purchase only what applies to it', () => {
    expect(names(applicableSteps(CATALOG, at(1, 'Pendiente')))).toEqual([
      'Pendiente',
      'En ruta',
      'Entregado',
      'Recolectado',
      'Listo',
    ]);
    const sale = at(1, 'Pendiente', { lines: [{ isRental: false }] } as Partial<OrderDetail>);
    expect(names(applicableSteps(CATALOG, sale))).toEqual(['Pendiente', 'En ruta', 'Entregado']);
    expect(isRentalOrder(sale)).toBe(false);
  });

  it('keeps the off-ramps out of the pipeline', () => {
    expect(names(disruptiveSteps(CATALOG))).toEqual(['Cancelado']);
  });
});

describe('stepsBetween', () => {
  it('walks every step in the direction of travel', () => {
    expect(names(stepsBetween(CATALOG, at(1, 'Pendiente'), target(6)))).toEqual([
      'En ruta',
      'Entregado',
      'Recolectado',
      'Listo',
    ]);
    expect(names(stepsBetween(CATALOG, at(6, 'Listo'), target(5)))).toEqual([
      'Recolectado',
      'Entregado',
      'En ruta',
    ]);
  });

  it('is a single move for a cancel, and nothing for a no-op', () => {
    expect(names(stepsBetween(CATALOG, at(3, 'Entregado'), target(2)))).toEqual(['Cancelado']);
    expect(stepsBetween(CATALOG, at(3, 'Entregado'), target(3))).toEqual([]);
  });

  it('places a CANCELLED order directly back on the chosen step', () => {
    const cancelled = at(2, 'Cancelado', { cancelledAt: '2026-07-20T10:00:00.000Z' });
    expect(names(stepsBetween(CATALOG, cancelled, target(3)))).toEqual(['Entregado']);
    // …and cancelling an already-cancelled order is nothing at all.
    expect(stepsBetween(CATALOG, cancelled, target(2))).toEqual([]);
  });

  it('has nothing to walk when the order sits outside the applicable pipeline', () => {
    const sale = at(3, 'Entregado', { lines: [{ isRental: false }] } as Partial<OrderDetail>);
    // A purchase-only order can't reach a rental-only step: the target isn't on its pipeline.
    expect(stepsBetween(CATALOG, sale, target(6))).toEqual([]);
  });
});

describe('evidenceSteps', () => {
  it('asks only for the FORWARD steps that demand photos, all in one pass', () => {
    expect(names(evidenceSteps(CATALOG, at(1, 'Pendiente'), target(4)))).toEqual([
      'Entregado',
      'Recolectado',
    ]);
  });

  it('never asks when going back, cancelling or reopening', () => {
    expect(evidenceSteps(CATALOG, at(6, 'Listo'), target(1))).toEqual([]);
    expect(evidenceSteps(CATALOG, at(3, 'Entregado'), target(2))).toEqual([]);
    const cancelled = at(2, 'Cancelado', { cancelledAt: '2026-07-20T10:00:00.000Z' });
    expect(evidenceSteps(CATALOG, cancelled, target(3))).toEqual([]);
  });
});

describe('purgedSteps', () => {
  it('names every documented step a rewind will destroy', () => {
    // Listo → En ruta undoes Recolectado and Entregado; both carried photos.
    expect(names(purgedSteps(CATALOG, at(6, 'Listo'), target(5)))).toEqual([
      'Entregado',
      'Recolectado',
    ]);
  });

  it('destroys nothing going forward, cancelling, or reopening', () => {
    expect(purgedSteps(CATALOG, at(1, 'Pendiente'), target(6))).toEqual([]);
    expect(purgedSteps(CATALOG, at(3, 'Entregado'), target(2))).toEqual([]);
    const cancelled = at(2, 'Cancelado', { cancelledAt: '2026-07-20T10:00:00.000Z' });
    expect(purgedSteps(CATALOG, cancelled, target(1))).toEqual([]);
  });
});

describe('walkInventoryEffect', () => {
  const CANCELLED = { cancelledAt: '2026-07-20T10:00:00.000Z' };
  const SALE = { lines: [{ isRental: false }] } as Partial<OrderDetail>;

  it('reads only the ENDPOINTS of the walk — a jump is applied in one transaction', () => {
    // Pendiente → Listo crosses three holding steps, but lands on the one that frees the units.
    expect(walkInventoryEffect(CATALOG, at(1, 'Pendiente'), target(6))).toBe('release');
    // …and the reverse takes them all back.
    expect(walkInventoryEffect(CATALOG, at(6, 'Listo'), target(1))).toBe('reclaim');
  });

  it('says nothing when the reservation does not change', () => {
    // Both hold OUT: moving between them reserves nothing new and frees nothing.
    expect(walkInventoryEffect(CATALOG, at(5, 'En ruta'), target(3))).toBe('none');
    // Pendiente holds the WINDOW and En ruta holds outright — still a hold either way.
    expect(walkInventoryEffect(CATALOG, at(1, 'Pendiente'), target(5))).toBe('none');
  });

  it('treats REOPENING as taking the goods back — unless they were already delivered', () => {
    const cancelled = at(2, 'Cancelado', CANCELLED);
    expect(walkInventoryEffect(CATALOG, cancelled, target(5))).toBe('reclaim');
    // Landing back on the step that holds nothing still reclaims nothing for a rental…
    expect(walkInventoryEffect(CATALOG, cancelled, target(6))).toBe('none');
    // …and a delivered SALE order can never get its units back: the client has them.
    const deliveredSale = at(2, 'Cancelado', {
      ...CANCELLED,
      ...SALE,
      deliveredAt: '2026-07-19T10:00:00.000Z',
    });
    expect(walkInventoryEffect(CATALOG, deliveredSale, target(3))).toBe('none');
    // An undelivered one does — that is the reopen that can be refused on availability.
    expect(walkInventoryEffect(CATALOG, at(2, 'Cancelado', { ...CANCELLED, ...SALE }), target(3))).toBe(
      'reclaim',
    );
  });

  it('never invents a rental effect on a purchase-only order', () => {
    // En ruta "holds" rental units, but this order has none — and walking the pipeline never moves
    // sale stock (it is decremented at creation, not at delivery).
    const sale = at(5, 'En ruta', SALE);
    expect(walkInventoryEffect(CATALOG, sale, target(3))).toBe('none');
    // A status that vanished from the catalog holds nothing, so nothing can be "freed" from it.
    expect(walkInventoryEffect(CATALOG, at(99, 'Desconocido'), target(6))).toBe('none');
  });
});

