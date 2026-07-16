import { describe, expect, it } from 'vitest';
import type { OrderListItem } from './order.types';
import {
  formatDayLabel,
  formatShortDate,
  formatTime,
  groupOrdersByDay,
  isSameLocalDay,
} from './orderDayGroups';

// Local-time constructor strings (no Z) so the LOCAL calendar-day grouping is deterministic
// regardless of the machine's timezone.
const NOW = new Date('2026-07-16T09:00:00');

const order = (id: number, deliveryAt: string): OrderListItem => ({
  id,
  clientName: `Cliente ${id}`,
  isRegistryClient: false,
  eventType: { id: 1, name: 'Evento familiar' },
  status: { id: 1, name: 'Pendiente' },
  paymentStatus: { id: 1, name: 'Pendiente' },
  deliveryAt: new Date(deliveryAt).toISOString(),
  itemCount: 1,
  totalAmount: 100,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
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
