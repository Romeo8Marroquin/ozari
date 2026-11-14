import { appConfig } from "@/config/app.js";

/**
 * Calendar arithmetic in the BUSINESS's time zone (`appConfig.businessTimeZone`), never the server's.
 *
 * Why this exists: `new Date(y, m, d)` / `getDate()` read the PROCESS zone. On a developer's machine
 * in Guatemala that is the right answer, so every test passed; on Cloud Run it is UTC, so "today"
 * ran from 18:00 yesterday to 18:00 today Guatemala time and an 8:30 p. m. delivery was counted on
 * TOMORROW (production, 2026-11-13: "Entregas de hoy 0" beside a delivery due that night). Anything
 * that asks "which day / which month is this instant in?" must come through here.
 *
 * Instants stay instants (UTC `Date`s, compared in SQL as such); only the BOUNDARIES are zoned.
 * No dependency: `Intl` ships the tz database with Node, and the offset is re-read at the computed
 * instant, so a zone with DST would still land on the right midnight.
 */

/** A wall-clock reading of an instant in a zone. `month` is 1–12. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** What a wall clock in `timeZone` reads at `date`. */
export function zonedParts(date: Date, timeZone: string = appConfig.businessTimeZone): ZonedParts {
  const parts: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    // Skips the separators ("literal") — every field we asked for is one of these six.
    if (part.type in parts) {
      parts[part.type as keyof ZonedParts] = Number(part.value);
    }
  }
  return parts;
}

/** The zone's offset from UTC at `instant`, in ms (Guatemala: −6 h). */
function offsetMs(instant: number, timeZone: string): number {
  const wall = zonedParts(new Date(instant), timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant of 00:00 on a calendar date in `timeZone`. `monthIndex` is 0-based and, like
 * `Date.UTC`, both it and `day` may overflow (`day + 1` past the month's end, `monthIndex - 8`
 * across a year), which is what makes "tomorrow" and "eight months ago" one-liners.
 */
export function zonedMidnight(
  year: number,
  monthIndex: number,
  day: number,
  timeZone: string = appConfig.businessTimeZone,
): Date {
  const wallAsUtc = Date.UTC(year, monthIndex, day);
  const first = wallAsUtc - offsetMs(wallAsUtc, timeZone);
  // Re-read the offset AT the candidate: across a DST change the guess's offset is the wrong one.
  return new Date(wallAsUtc - offsetMs(first, timeZone));
}

/** A half-open `[from, to)` range of instants. */
export interface BusinessRange {
  from: Date;
  to: Date;
}

/** The business day containing `now`, half-open. */
export function businessDayRange(now: Date, timeZone: string = appConfig.businessTimeZone): BusinessRange {
  const { year, month, day } = zonedParts(now, timeZone);
  return {
    from: zonedMidnight(year, month - 1, day, timeZone),
    to: zonedMidnight(year, month - 1, day + 1, timeZone),
  };
}

/** The business month containing `now`, shifted by `offsetMonths` (0 = this one, −1 = last). */
export function businessMonthRange(
  now: Date,
  offsetMonths = 0,
  timeZone: string = appConfig.businessTimeZone,
): BusinessRange {
  const { year, month } = zonedParts(now, timeZone);
  return {
    from: zonedMidnight(year, month - 1 + offsetMonths, 1, timeZone),
    to: zonedMidnight(year, month + offsetMonths, 1, timeZone),
  };
}

/** `YYYY-MM` of the business month an instant falls in. */
export function businessMonthKey(date: Date, timeZone: string = appConfig.businessTimeZone): string {
  const { year, month } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The `count` business months ending with the one containing `now`, oldest first, as keys. Pure
 *  calendar arithmetic on (year, month) — no instant is involved past reading `now`'s month. */
export function trailingBusinessMonthKeys(
  now: Date,
  count: number,
  timeZone: string = appConfig.businessTimeZone,
): string[] {
  const { year, month } = zonedParts(now, timeZone);
  return Array.from({ length: count }, (_, index) => {
    const shifted = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** `8:30 p. m.` — a time as the business reads it (es-GT, in its zone). */
export function formatBusinessTime(date: Date, timeZone: string = appConfig.businessTimeZone): string {
  return new Intl.DateTimeFormat("es-GT", { hour: "numeric", minute: "2-digit", timeZone }).format(
    date,
  );
}
