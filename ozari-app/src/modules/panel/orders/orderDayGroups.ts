import type { OrderListItem } from './order.types';

/**
 * One day of the agenda/history list. `kind` marks the relative days that get localized labels
 * (Hoy / Mañana / Ayer); `other` days render `date` through {@link formatDayLabel}.
 */
export interface OrderDayGroup {
  /** Stable local-calendar-day key, e.g. `2026-08-01` — the React key for the section. */
  key: string;
  kind: 'today' | 'tomorrow' | 'yesterday' | 'other';
  date: Date;
  orders: OrderListItem[];
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** The LOCAL calendar-day key of a date — grouping is by the user's wall-clock day. */
const dayKeyOf = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const shiftedKey = (now: Date, days: number): string => {
  const shifted = new Date(now);
  shifted.setDate(shifted.getDate() + days);
  return dayKeyOf(shifted);
};

/**
 * Groups an already-sorted order list (the backend orders by `deliveryAt`) into local calendar
 * days, preserving the incoming sequence — so the agenda cascades soonest-first and history
 * newest-first without re-sorting. Relative days are tagged for localized headers.
 */
export function groupOrdersByDay(orders: OrderListItem[], now = new Date()): OrderDayGroup[] {
  const todayKey = dayKeyOf(now);
  const tomorrowKey = shiftedKey(now, 1);
  const yesterdayKey = shiftedKey(now, -1);

  const groups = new Map<string, OrderDayGroup>();
  for (const order of orders) {
    const date = new Date(order.deliveryAt);
    const key = dayKeyOf(date);
    const existing = groups.get(key);
    if (existing) {
      existing.orders.push(order);
      continue;
    }
    const kind =
      key === todayKey
        ? 'today'
        : key === tomorrowKey
          ? 'tomorrow'
          : key === yesterdayKey
            ? 'yesterday'
            : 'other';
    groups.set(key, { key, kind, date, orders: [order] });
  }
  return [...groups.values()];
}

/**
 * A day header for a non-relative day: `viernes 7 de agosto` in es-GT, capitalized, with the year
 * appended only when it differs from the current one (an agenda mostly lives inside "this year").
 */
export function formatDayLabel(date: Date, now = new Date()): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  const label = new Intl.DateTimeFormat('es-GT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** An event time as the ticket shows it — `2:00 p. m.` in es-GT. */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-GT', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/** Whether two ISO instants fall on the same LOCAL calendar day. */
export function isSameLocalDay(aIso: string, bIso: string): boolean {
  return dayKeyOf(new Date(aIso)) === dayKeyOf(new Date(bIso));
}

/** A compact date marker (`2 ago`) for a pickup that lands on a different day than its delivery. */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'short' }).format(new Date(iso));
}
