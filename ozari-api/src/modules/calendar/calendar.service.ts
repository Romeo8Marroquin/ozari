import { appConfig } from "@/config/app.js";
import { i18next } from "@/config/i18n.js";
import {
  logisticsEvents,
  padMinutesFor,
} from "../orders/logistics/logistics.service.js";
import type { LogisticsEventKindModel } from "../orders/logistics/logistics.models.js";
import type { CalendarEntryModel, CalendarOrderModel } from "./calendar.models.js";

const MINUTE_MS = 60 * 1000;

/**
 * THE CALENDAR ENTRY, decided once.
 *
 * Everything an external calendar shows is built here — the title, the window, the reminder — so a
 * Google event and the same job in the ICS feed are the same job. The two transports differ only in
 * how they serialise what this module returns.
 */

/**
 * The stable id for one order's one event.
 *
 * **Deterministic on purpose, which is what removes an entire mapping table.** Google lets a caller
 * choose an event's id, so re-syncing an order addresses the very same event instead of needing a
 * `service_id → external_id` row to look it up — and a delete needs nothing but the order id. The
 * same string is the ICS `UID`, so a subscribed calendar updates its copy rather than accumulating
 * duplicates.
 *
 * The alphabet is Google's, not ours: an event id must match `[a-v0-9]+` and be at least 5
 * characters. That is why the prefix is `orden` (every letter inside a–v) and the kind is a single
 * letter rather than the word — `deliverY`'s `y` would be rejected, silently, at insert time.
 */
export function calendarEntryId(
  orderId: number,
  kind: LogisticsEventKindModel,
): string {
  return `orden${orderId}${kind === "DELIVERY" ? "d" : "c"}`;
}

/**
 * How many minutes before an event to remind — **clamped so the reminder can never sit in the past.**
 *
 * This is the edge case the whole feature turns on. A calendar fires a reminder at
 * `start − minutes`; if that instant has already gone by, **nothing fires at all**. So an order
 * booked 16 hours out with a 24-hour lead would be entered into the calendar and then never
 * announced — the one failure this integration exists to prevent, and the one you would only notice
 * by missing a delivery.
 *
 * The rule: ask for the configured lead, but never for more time than actually remains **minus a
 * safety margin** (`reminderSafetyMinutes`). When the order is created inside the lead window the
 * reminder lands a few minutes out — which is the honest answer, because "we cannot warn you a day
 * ahead of something happening in sixteen hours" leaves only "so you are being told now".
 *
 * ⚠️ **The margin is not padding, it is the difference between a notification and silence.** Clamping
 * to exactly the time remaining puts the trigger instant on `now` — and the event still has to travel
 * to Google over the network, or be fetched and parsed by a phone, so by the time anyone evaluates it
 * the instant has passed. Neither vendor documents what happens then; "fires immediately" and "never
 * fires" are both plausible, and the second is a delivery nobody was warned about. Reserving a few
 * minutes makes the trigger provably future at the moment we hand it over, so the outcome stops
 * depending on a race we do not control.
 *
 * The margin only ever bites in the clamped case: with room for the configured lead, that lead is
 * returned untouched. And when there is not even room for the margin (an event minutes away), the
 * answer is a ZERO lead — a reminder at the event's own start, which is still in the future for as
 * long as `minutesUntil > 0` and therefore safe by the same argument.
 *
 * Returns `undefined` when the event has already started: there is nothing left to warn about, and
 * a zero-minute reminder on a past event is noise at best.
 */
export function reminderMinutesFor(
  start: Date,
  now: Date,
  configuredMinutes: number,
): number | undefined {
  const minutesUntil = (start.getTime() - now.getTime()) / MINUTE_MS;
  if (minutesUntil <= 0) {
    return undefined;
  }
  // `floor` after subtracting the margin, so the reminder instant is at least that far ahead of
  // `now` — never a few seconds behind it, where it would be dropped.
  const available = Math.floor(minutesUntil - appConfig.calendar.reminderSafetyMinutes);
  const wanted = Math.min(configuredMinutes, appConfig.calendar.google.maxReminderMinutes);
  return Math.max(0, Math.min(wanted, available));
}

/**
 * The block one event occupies — **the same window the driver-availability pad reserves**
 * (`padMinutesFor`), not a made-up duration.
 *
 * That reuse is the point (EPIC-2-DRIVER-AVAILABILITY §6): the hour the system refuses to
 * double-book is exactly the hour that appears in the calendar, so what the admin sees and what the
 * system enforces are one fact. Change the spacing preference and both move together.
 */
export function calendarWindow(
  at: Date,
  kind: LogisticsEventKindModel,
  gapMinutes: number,
): { start: Date; end: Date } {
  const pad = padMinutesFor({ at, kind }, gapMinutes);
  return {
    start: new Date(at.getTime() - pad.before * MINUTE_MS),
    end: new Date(at.getTime() + pad.after * MINUTE_MS),
  };
}

/**
 * How many times this order has been rewritten — the `SEQUENCE` a subscribing calendar compares to
 * decide whether its copy is stale.
 *
 * Derived from the timestamps rather than counted, because there is no column to count with and
 * adding one would mean a write on every sync. Whole minutes since creation: monotonic (it can only
 * grow as the row is edited), stable (re-serialising an unchanged order yields the same number, so a
 * refresh is not treated as a change), and far below the 32-bit bound for any realistic order.
 */
export function calendarSequence(order: CalendarOrderModel): number {
  const updated = order.updatedAt ?? order.createdAt;
  return Math.max(
    0,
    Math.floor((updated.getTime() - order.createdAt.getTime()) / MINUTE_MS),
  );
}

/**
 * The entries an order contributes to a calendar — **only the events it still has to perform.**
 *
 * A cancelled order contributes nothing, and neither does a step that already happened: a delivery
 * confirmed this morning is history, and leaving it on tomorrow's calendar would have the admin
 * being reminded about work they have already done. That is the same OCCUPANCY rule the logistics
 * pad reads (`deliveredAt` / `collectedAt`, never a status id), so a rewind puts the entry back by
 * itself.
 *
 * `now` is threaded in rather than read here so the whole payload is one instant — the dashboard's
 * rule, for the same reason.
 */
export function calendarEntriesFor(
  order: CalendarOrderModel,
  options: { gapMinutes: number; reminderMinutes: number; now: Date },
): CalendarEntryModel[] {
  if (order.cancelledAt) {
    return [];
  }
  const done: Record<LogisticsEventKindModel, boolean> = {
    DELIVERY: Boolean(order.deliveredAt),
    COLLECTION: Boolean(order.collectedAt),
  };
  const sequence = calendarSequence(order);
  return logisticsEvents(order)
    .filter((event) => !done[event.kind])
    .map((event) => {
      const { start, end } = calendarWindow(event.at, event.kind, options.gapMinutes);
      const reminder = reminderMinutesFor(start, options.now, options.reminderMinutes);
      return {
        id: calendarEntryId(order.id, event.kind),
        orderId: order.id,
        kind: event.kind,
        start,
        end,
        at: event.at,
        summary: entrySummary(event.kind, order.clientName),
        description: entryDescription(order, event.at),
        ...(order.address ? { location: order.address } : {}),
        ...(reminder !== undefined ? { reminderMinutes: reminder } : {}),
        sequence,
      };
    });
}

/**
 * The one line that has to work in a month grid on a phone: **what, and for whom.**
 *
 * "Entrega · María López" — the kind first, because when three things are on one day that is what
 * you scan for, and the client's name second, because it is what identifies the job. Deliberately
 * NOT the order number: an id is meaningless in a calendar you are reading at a glance, and the
 * detail is one tap away in the description.
 */
export function entrySummary(
  kind: LogisticsEventKindModel,
  clientName: string,
): string {
  return `${i18next.t(`calendar.kinds.${kind}`)} · ${clientName}`;
}

/**
 * The body: the exact time (the block around it is padding, not the appointment), what the job is,
 * and where. Blank facts are dropped rather than printed as empty labels.
 *
 * `at` is passed IN rather than picked from the order by kind. The caller already has it — the
 * events it iterates are the source of both — and deriving it here would need a `?? deliveryAt`
 * fallback for a COLLECTION with no pickup, which cannot exist (`logisticsEvents` only emits one
 * when there is a pickup). An unreachable branch is a lie about the code's shape.
 */
export function entryDescription(order: CalendarOrderModel, at: Date): string {
  return [
    i18next.t("calendar.description.at", { time: formatLocalTime(at) }),
    i18next.t("calendar.description.event", {
      event: order.eventTypeName,
      count: order.itemCount,
    }),
    order.address
      ? i18next.t("calendar.description.address", { address: order.address })
      : "",
    i18next.t("calendar.description.order", { id: order.id }),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** `2:00 p. m.` in the business's own locale — the description is read by a person, not parsed. */
function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat("es-GT", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

// ── ICS (RFC 5545) ────────────────────────────────────────────────────────────────────────────

/** `20260801T140000Z` — the only date form that needs no VTIMEZONE block, and the only one that is
 *  unambiguous on a phone that travels. */
export function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

/**
 * Escape a TEXT value: backslash first (or it would double-escape the escapes we add next), then
 * the separators that would otherwise end the value, then real newlines as the literal `\n` the
 * format uses. Getting the ORDER wrong here produces a calendar that parses but shows mangled text.
 */
export function icsEscape(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/;/gu, "\\;")
    .replace(/,/gu, "\\,")
    .replace(/\r?\n/gu, "\\n");
}

/**
 * Fold a content line to 75 OCTETS, per RFC 5545 §3.1.
 *
 * Octets, not characters — an accented Spanish name is two bytes in UTF-8, so counting characters
 * would emit lines that are legal by our arithmetic and over the limit in the file. A continuation
 * begins with a single space, which parsers strip. Strict clients (Apple's included) reject a
 * calendar with an over-long line outright, so this is correctness, not tidiness.
 */
export function icsFold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) {
    return line;
  }
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // 74 on continuation lines: the leading space counts toward the 75.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}

/** One `VEVENT`, alarm included. Split out so the entry→lines mapping is testable without a whole
 *  calendar around it. */
export function icsEvent(entry: CalendarEntryModel, stamp: Date): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${entry.id}@ozari`,
    `DTSTAMP:${icsDate(stamp)}`,
    `DTSTART:${icsDate(entry.start)}`,
    `DTEND:${icsDate(entry.end)}`,
    `SEQUENCE:${entry.sequence}`,
    `SUMMARY:${icsEscape(entry.summary)}`,
    `DESCRIPTION:${icsEscape(entry.description)}`,
    ...(entry.location ? [`LOCATION:${icsEscape(entry.location)}`] : []),
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    ...(entry.reminderMinutes === undefined
      ? []
      : [
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `TRIGGER:-PT${entry.reminderMinutes}M`,
          `DESCRIPTION:${icsEscape(entry.summary)}`,
          "END:VALARM",
        ]),
    "END:VEVENT",
  ];
}

/**
 * A whole subscribable calendar.
 *
 * **A subscription is a MIRROR, not a log**: whatever this returns IS the calendar, so an order that
 * stops appearing here disappears from the subscriber's calendar on its next refresh. That is what
 * makes cancellation and deletion work without a single `METHOD:CANCEL` — the entry is simply not
 * emitted, because `calendarEntriesFor` already declined to build it.
 *
 * `REFRESH-INTERVAL` / `X-PUBLISHED-TTL` ask the client how often to come back. Apple honours it as
 * a default the user can change; Google ignores it and refreshes on its own (slow) schedule — which
 * is exactly why Google is served by the API integration instead of this.
 */
export function buildIcs(
  entries: readonly CalendarEntryModel[],
  options: { name: string; stamp: Date },
): string {
  const ttl = `PT${appConfig.calendar.feedRefreshMinutes}M`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${appConfig.calendar.icsProductId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(options.name)}`,
    `X-WR-TIMEZONE:${appConfig.calendar.timeZone}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${ttl}`,
    `X-PUBLISHED-TTL:${ttl}`,
    ...entries.flatMap((entry) => icsEvent(entry, options.stamp)),
    "END:VCALENDAR",
  ];
  // CRLF is not a style choice — RFC 5545 requires it, and some parsers reject bare LF outright.
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}
