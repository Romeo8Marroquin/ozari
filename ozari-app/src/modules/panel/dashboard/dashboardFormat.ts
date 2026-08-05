import type { StatComparison } from './dashboard.types';

const MONEY = new Intl.NumberFormat('es-GT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Compact money for a headline figure — `Q 12,400.00`. */
export function formatMoney(symbol: string, amount: number): string {
  return `${symbol} ${MONEY.format(amount)}`;
}

/**
 * A `YYYY-MM` trend key → the short month label the axis shows (`ago`, `sep`, …).
 *
 * Parsed from the PARTS rather than `new Date('2026-08')`, which JS reads as UTC midnight and can
 * therefore render as the PREVIOUS month for anyone west of Greenwich — Guatemala is UTC-6, so that
 * bug would shift every label on the chart by one.
 */
export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) {
    return monthKey;
  }
  return new Intl.DateTimeFormat('es-GT', { month: 'short' }).format(
    new Date(year, month - 1, 1),
  );
}

/** The three shapes a delta can take. `flat` covers an exact 0 as well as an absent comparison, and
 *  the UI words those two differently — hence `none` for "there is nothing to compare against". */
export type DeltaTone = 'up' | 'down' | 'flat' | 'none';

export function deltaTone(stat: StatComparison): DeltaTone {
  if (stat.deltaPercent === undefined) {
    return 'none';
  }
  if (stat.deltaPercent > 0) return 'up';
  if (stat.deltaPercent < 0) return 'down';
  return 'flat';
}

/**
 * How long ago the payload was computed, in whole SECONDS, floored at 0.
 *
 * Floored because a device clock a few seconds ahead of the server would otherwise render
 * "actualizado hace -1 min", which reads as a bug in the app rather than in the clock.
 */
export function secondsSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
}

/** The i18n leaf + count for the "actualizado hace…" line. */
export interface FreshnessLabel {
  key: 'justNow' | 'seconds' | 'minutes' | 'hours';
  count: number;
}

/**
 * How to word the age of the data.
 *
 * **In SECONDS below a minute, which is the whole point.** The dashboard re-reads itself every 60
 * seconds, so a minute-resolution label spent its entire life reading "hace 0 minutos" — a number
 * that is technically true, never changes, and therefore tells the reader nothing about whether the
 * screen is live. Seconds move, so the line becomes evidence that it is.
 *
 * The first ten seconds read "hace un momento" rather than counting up from one: at that range the
 * exact second is noise, and it stops the label from flickering through 1, 2, 3 immediately after
 * every fetch. Hours exist for the case the interval is not running at all — a backgrounded tab —
 * where "hace 154 minutos" would be worse than "hace 3 horas".
 */
export function freshnessLabel(seconds: number): FreshnessLabel {
  if (seconds < 10) {
    return { key: 'justNow', count: 0 };
  }
  if (seconds < 60) {
    return { key: 'seconds', count: seconds };
  }
  if (seconds < 3600) {
    return { key: 'minutes', count: Math.floor(seconds / 60) };
  }
  return { key: 'hours', count: Math.floor(seconds / 3600) };
}

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = MIN_PER_HOUR * 24;
/** Approximate on purpose: these are HUMAN labels ("hace 2 meses"), not calendar arithmetic. An
 *  order that is eleven months late does not need the label to know how many days February had. */
const MIN_PER_MONTH = MIN_PER_DAY * 30;
const MIN_PER_YEAR = MIN_PER_DAY * 365;

/** The unit a relative label is expressed in. `now` is its own thing — a magnitude of zero. */
export type MagnitudeUnit = 'minutes' | 'hours' | 'days' | 'months' | 'years';

export interface RelativeTime {
  /** `now` ⇒ no unit and no number: the label is a single word. */
  direction: 'past' | 'now' | 'future';
  unit?: MagnitudeUnit;
  /** Always POSITIVE — the direction carries the sign, so the copy never has to strip a minus. */
  value: number;
}

/**
 * A signed minute count → the biggest unit that still says something useful, in both directions.
 *
 * The point is that **"Atrasado 16047 minutos" is not a sentence anyone reads** — it is a number you
 * have to do arithmetic on to understand. The same ladder serves the countdown and the overdue
 * label, because they are the same question asked from either side of now, and having one function
 * means the two can never disagree about where "hours" becomes "days".
 *
 * Anything within ten minutes of now reads "ahora": at that range the exact minute is noise, and it
 * invites watching a clock nobody controls. (The past side has no such window — one minute late is
 * still late, and rounding it to "ahora" would hide the one label on this screen that must be
 * trusted.)
 */
export function relativeTime(minutes: number): RelativeTime {
  if (minutes >= 0 && minutes <= 10) {
    return { direction: 'now', value: 0 };
  }
  const direction = minutes < 0 ? 'past' : 'future';
  const magnitude = Math.abs(minutes);
  if (magnitude < MIN_PER_HOUR) {
    return { direction, unit: 'minutes', value: magnitude };
  }
  if (magnitude < MIN_PER_DAY) {
    return { direction, unit: 'hours', value: Math.round(magnitude / MIN_PER_HOUR) };
  }
  if (magnitude < MIN_PER_MONTH) {
    return { direction, unit: 'days', value: Math.round(magnitude / MIN_PER_DAY) };
  }
  if (magnitude < MIN_PER_YEAR) {
    return { direction, unit: 'months', value: Math.round(magnitude / MIN_PER_MONTH) };
  }
  return { direction, unit: 'years', value: Math.round(magnitude / MIN_PER_YEAR) };
}

/**
 * The i18n leaf for a relative label — `countdown.now`, `countdown.hours`, `overdue.days`, …
 *
 * Built here rather than at the call site so the copy is ONE `t(key, { count })` with plural
 * variants, instead of a ladder of ternaries producing half-sentences no translator can see whole.
 */
export function relativeKey(relative: RelativeTime): string {
  if (relative.direction === 'now') {
    return 'countdown.now';
  }
  const family = relative.direction === 'past' ? 'overdue' : 'countdown';
  return `${family}.${relative.unit}`;
}
