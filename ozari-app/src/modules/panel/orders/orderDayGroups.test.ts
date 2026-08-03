import { describe, expect, it } from 'vitest';
import type { OrderListItem } from './order.types';
import {
  formatDateTime,
  formatDayLabel,
  formatShortDate,
  formatTime,
  groupAgenda,
  groupHistory,
  groupOrdersByDay,
  isSameLocalDay,
  orderNextActionAt,
} from './orderDayGroups';

// Local-time constructor strings (no Z) so the LOCAL calendar-day grouping is deterministic
// regardless of the machine's timezone.
const NOW = new Date('2026-07-16T09:00:00');

const order = (id: number, deliveryAt: string, over: Partial<OrderListItem> = {}): OrderListItem => ({
  id,
  clientName: `Cliente ${id}`,
  isRegistryClient: false,
  eventType: { id: 1, name: 'Evento familiar' },
  status: { id: 1, name: 'Pendiente' },
  paymentStatus: { id: 1, name: 'Pendiente' },
  deliveryAt: new Date(deliveryAt).toISOString(),
  isMine: false,
  actions: [],
  holdsInventory: true,
  itemCount: 1,
  totalAmount: 100,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  ...over,
});

describe('groupOrdersByDay', () => {
  it('groups by local calendar day, preserving the incoming sequence', () => {
    const groups = groupOrdersByDay(
      [
        order(1, '2026-07-16T10:00:00'),
        order(2, '2026-07-16T15:00:00'),
        order(3, '2026-07-17T09:00:00'),
        order(4, '2026-07-20T09:00:00'),
      ],
      NOW,
    );
    expect(groups.map((group) => group.orders.map((entry) => entry.id))).toEqual([
      [1, 2],
      [3],
      [4],
    ]);
    expect(groups.map((group) => group.key)).toEqual(['2026-07-16', '2026-07-17', '2026-07-20']);
  });

  it('tags the relative days: today, tomorrow, yesterday, other', () => {
    const groups = groupOrdersByDay(
      [
        order(1, '2026-07-16T10:00:00'),
        order(2, '2026-07-17T10:00:00'),
        order(3, '2026-07-15T10:00:00'),
        order(4, '2026-08-07T10:00:00'),
      ],
      NOW,
    );
    expect(groups.map((group) => group.kind)).toEqual(['today', 'tomorrow', 'yesterday', 'other']);
  });

  it('returns no groups for an empty list', () => {
    expect(groupOrdersByDay([], NOW)).toEqual([]);
  });

  it('files rows under the day the accessor picks (e.g. the next action, not the delivery)', () => {
    // A delivered rental with a pickup on the 17th, delivered on the 16th → grouped under the 17th.
    const delivered = order(1, '2026-07-16T10:00:00', {
      deliveredAt: new Date('2026-07-16T10:20:00').toISOString(),
      pickupAt: new Date('2026-07-17T10:00:00').toISOString(),
    });
    const groups = groupOrdersByDay([delivered], NOW, orderNextActionAt);
    expect(groups.map((g) => g.key)).toEqual(['2026-07-17']);
  });
});

describe('orderNextActionAt', () => {
  const delivery = '2026-07-16T10:00:00';
  const pickup = '2026-07-18T10:00:00';
  const delivered = '2026-07-16T10:30:00';
  const collected = '2026-07-18T10:30:00';
  const iso = (value: string) => new Date(value).toISOString();

  it('reads the tracked ACTUALS, not the status (mirrors the backend)', () => {
    // Nothing tracked yet → the delivery, whatever the order's status is called.
    expect(
      orderNextActionAt(
        order(1, delivery, { status: { id: 42, name: 'Preparando en bodega' } }),
      ).toISOString(),
    ).toBe(iso(delivery));

    // Delivered rental → its pickup; delivered purchase (no pickup) → the delivered actual.
    const deliveredRental = order(1, delivery, {
      deliveredAt: iso(delivered),
      pickupAt: iso(pickup),
    });
    expect(orderNextActionAt(deliveredRental).toISOString()).toBe(iso(pickup));
    expect(
      orderNextActionAt(order(1, delivery, { deliveredAt: iso(delivered) })).toISOString(),
    ).toBe(iso(delivered));

    // Collected → the collection moment (it's waiting out the washing period).
    expect(
      orderNextActionAt(
        order(1, delivery, {
          deliveredAt: iso(delivered),
          pickupAt: iso(pickup),
          collectedAt: iso(collected),
        }),
      ).toISOString(),
    ).toBe(iso(collected));
  });
});

describe('groupAgenda', () => {
  it('splits MINE-first / the-rest bands when both exist, each grouped by next-action day', () => {
    const sections = groupAgenda(
      [
        order(1, '2026-07-16T18:00:00', { isMine: true }),
        order(2, '2026-07-17T09:00:00', { isMine: true }),
        order(3, '2026-07-16T06:00:00', { isMine: false }),
      ],
      NOW,
    );
    expect(sections.map((s) => s.owner)).toEqual(['mine', 'rest']);
    expect(sections[0].days.flatMap((d) => d.orders.map((o) => o.id))).toEqual([1, 2]);
    expect(sections[1].days.flatMap((d) => d.orders.map((o) => o.id))).toEqual([3]);
  });

  it('collapses to a single un-split band when only one side has rows', () => {
    const onlyRest = groupAgenda([order(1, '2026-07-16T10:00:00', { isMine: false })], NOW);
    expect(onlyRest.map((s) => s.owner)).toEqual(['all']);
    const onlyMine = groupAgenda([order(2, '2026-07-16T10:00:00', { isMine: true })], NOW);
    expect(onlyMine.map((s) => s.owner)).toEqual(['all']);
  });
});

describe('groupHistory', () => {
  it('is one chronological band by delivery day', () => {
    const sections = groupHistory(
      [order(1, '2026-07-16T10:00:00'), order(2, '2026-07-14T10:00:00')],
      NOW,
    );
    expect(sections.map((s) => s.owner)).toEqual(['all']);
    expect(sections[0].days.map((d) => d.key)).toEqual(['2026-07-16', '2026-07-14']);
  });
});

describe('formatDayLabel', () => {
  it('formats a capitalized es-GT weekday + day + month, without the current year', () => {
    // 2026-08-07 is a Friday (viernes). Exact separators vary slightly across ICU versions, so
    // assert the parts: capitalized weekday, the day + month, and no year.
    const label = formatDayLabel(new Date('2026-08-07T10:00:00'), NOW);
    expect(label).toMatch(/^Viernes/);
    expect(label).toMatch(/7 de agosto/);
    expect(label).not.toContain('2026');
  });

  it('appends the year only when it differs from the current one', () => {
    expect(formatDayLabel(new Date('2027-01-05T10:00:00'), NOW)).toContain('2027');
  });
});

describe('time helpers', () => {
  it('formatTime renders an es-GT clock time', () => {
    expect(formatTime(new Date('2026-07-16T14:00:00').toISOString())).toMatch(/2:00/);
  });

  it('formatDateTime names the DAY too — copy about another order cannot rely on a heading', () => {
    const label = formatDateTime(new Date('2026-07-16T14:30:00').toISOString());
    expect(label).toMatch(/16/);
    expect(label).toMatch(/2:30/);
  });

  it('isSameLocalDay compares local calendar days, not 24h windows', () => {
    const evening = new Date('2026-07-16T23:00:00').toISOString();
    const nextMorning = new Date('2026-07-17T01:00:00').toISOString();
    const sameDay = new Date('2026-07-16T08:00:00').toISOString();
    expect(isSameLocalDay(evening, nextMorning)).toBe(false);
    expect(isSameLocalDay(evening, sameDay)).toBe(true);
  });

  it('formatShortDate renders a compact day + short month', () => {
    expect(formatShortDate(new Date('2026-08-02T10:00:00').toISOString())).toMatch(/2/);
  });
});
