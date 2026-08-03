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

/**
 * One OWNER band of the agenda: `mine` (assigned to the viewer) always precedes `rest` (everyone
 * else's / unassigned); `all` is the single un-split band shown when there is nothing to distinguish
 * (a Driver sees only their own; an Admin with no self-assignments sees just the rest). Each band
 * carries its own day groups.
 */
export type OrderOwnerKind = 'mine' | 'rest' | 'all';
export interface OrderOwnerSection {
  owner: OrderOwnerKind;
  days: OrderDayGroup[];
}

/**
 * The moment of an order's NEXT logistics action — the mirror of the backend `computeNextActionAt`
 * that the agenda both orders and DAY-GROUPS by (owner rule: group by the day of the NEXT event, not
 * the original delivery).
 *
 * Derived from the tracked ACTUALS, never from a status id: since the lifecycle became a data-driven
 * machine the admin can rename/reorder/add statuses, but "it has been delivered / collected" stays a
 * fact. Collected ⇒ its collection moment (it's waiting out the washing period for the "listo"
 * press); delivered ⇒ its pickup (a purchase-only order has none, so its delivered moment stands
 * in); otherwise ⇒ its delivery.
 */
export function orderNextActionAt(order: OrderListItem): Date {
  if (order.collectedAt !== undefined) return new Date(order.collectedAt);
  if (order.deliveredAt !== undefined)
    return new Date(order.pickupAt ?? order.deliveredAt);
  return new Date(order.deliveryAt);
}

/** History reads chronologically by the original delivery, not the next action. */
const deliveryDateOf = (order: OrderListItem): Date => new Date(order.deliveryAt);

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
 * Groups an already-sorted order list into local calendar days, preserving the incoming sequence —
 * so the agenda cascades next-action-soonest-first and history newest-first without re-sorting. The
 * `dateOf` accessor picks WHICH instant a row is filed under (its next action on the agenda, its
 * delivery in history). Relative days are tagged for localized headers.
 */
export function groupOrdersByDay(
  orders: OrderListItem[],
  now = new Date(),
  dateOf: (order: OrderListItem) => Date = deliveryDateOf,
): OrderDayGroup[] {
  const todayKey = dayKeyOf(now);
  const tomorrowKey = shiftedKey(now, 1);
  const yesterdayKey = shiftedKey(now, -1);

  const groups = new Map<string, OrderDayGroup>();
  for (const order of orders) {
    const date = dateOf(order);
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

/**
 * A moment named in FULL (`2 ago, 2:30 p. m.`) — for copy that points at an event the reader is
 * not currently looking at, like the order a driver conflict clashes with. The agenda can say just
 * a time because its day heading already carries the date; a conflict message cannot.
 */
export function formatDateTime(iso: string): string {
  return `${formatShortDate(iso)}, ${formatTime(iso)}`;
}

/**
 * The AGENDA grouping: split into MINE-first / the-rest owner bands (from the backend's `isMine`
 * flag; the list already arrives mine-first), each grouped by its NEXT-ACTION day. When only one
 * band has rows — a Driver (all theirs) or an Admin with nothing self-assigned — it collapses to a
 * single `all` band with no owner header (there is nothing to tell apart). The incoming order is
 * preserved throughout, so the flat sequence still matches the backend's ordering for pagination.
 */
export function groupAgenda(orders: OrderListItem[], now = new Date()): OrderOwnerSection[] {
  const mine = orders.filter((order) => order.isMine);
  const rest = orders.filter((order) => !order.isMine);
  if (mine.length > 0 && rest.length > 0) {
    return [
      { owner: 'mine', days: groupOrdersByDay(mine, now, orderNextActionAt) },
      { owner: 'rest', days: groupOrdersByDay(rest, now, orderNextActionAt) },
    ];
  }
  return [{ owner: 'all', days: groupOrdersByDay(orders, now, orderNextActionAt) }];
}

/** The HISTORY grouping: a single chronological band by delivery day (no owner split — a finished
 *  log reads by date, and the rows are already role-scoped by the backend). */
export function groupHistory(orders: OrderListItem[], now = new Date()): OrderOwnerSection[] {
  return [{ owner: 'all', days: groupOrdersByDay(orders, now, deliveryDateOf) }];
}
