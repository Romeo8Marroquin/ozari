import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/i18n.js", () => ({
  i18next: {
    t: vi.fn((key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${Object.values(options).join(",")}` : key,
    ),
  },
}));

import {
  buildIcs,
  calendarEntriesFor,
  calendarEntryId,
  calendarSequence,
  calendarWindow,
  icsDate,
  icsEscape,
  icsEvent,
  icsFold,
  reminderMinutesFor,
} from "./calendar.service.js";
import type { CalendarOrderModel } from "./calendar.models.js";

const NOW = new Date("2026-08-01T08:00:00.000Z");

const order = (over: Partial<CalendarOrderModel> = {}): CalendarOrderModel => ({
  id: 12,
  deliveryAt: new Date("2026-08-02T14:00:00.000Z"),
  pickupAt: new Date("2026-08-02T20:00:00.000Z"),
  deliveredAt: null,
  collectedAt: null,
  cancelledAt: null,
  updatedAt: null,
  createdAt: new Date("2026-08-01T07:00:00.000Z"),
  clientName: "María López",
  address: "Zona 10, 4a avenida 5-55",
  eventTypeName: "Evento familiar",
  itemCount: 25,
  ...over,
});

describe("calendarEntryId", () => {
  it("uses ONLY the alphabet Google accepts for an event id", () => {
    // The id must match [a-v0-9]+ and be 5+ characters. "orden" is inside a–v and the kind is a
    // single letter for the same reason — a `y` from "delivery" would be rejected at insert time,
    // silently, on every order.
    expect(calendarEntryId(12, "DELIVERY")).toBe("orden12d");
    expect(calendarEntryId(12, "COLLECTION")).toBe("orden12c");
    for (const kind of ["DELIVERY", "COLLECTION"] as const) {
      expect(calendarEntryId(9, kind)).toMatch(/^[a-v0-9]{5,}$/u);
    }
  });

  it("is DETERMINISTIC, which is what removes the mapping table", () => {
    // Re-syncing addresses the same event instead of needing a stored external id, and a delete
    // needs nothing but the order id.
    expect(calendarEntryId(12, "DELIVERY")).toBe(calendarEntryId(12, "DELIVERY"));
    expect(calendarEntryId(13, "DELIVERY")).not.toBe(calendarEntryId(12, "DELIVERY"));
  });
});

describe("reminderMinutesFor", () => {
  const inHours = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

  it("asks for the configured lead when there is room for it", () => {
    expect(reminderMinutesFor(inHours(48), NOW, 1440)).toBe(1440);
  });

  it("CLAMPS to the time that actually remains — the edge case the feature turns on", () => {
    // A calendar fires at `start − minutes`; if that instant has gone by, NOTHING fires. So an order
    // booked 16 hours out with a 24-hour lead would be entered and never announced. Clamped, the
    // reminder lands now, which is the honest answer.
    expect(reminderMinutesFor(inHours(16), NOW, 1440)).toBe(16 * 60);
    expect(reminderMinutesFor(inHours(0.5), NOW, 1440)).toBe(30);
  });

  it("never asks for a reminder in the PAST, however little time is left", () => {
    // Half a minute out: `floor` keeps the reminder instant at or after now rather than a few
    // seconds behind it, where it would be dropped.
    const soon = new Date(NOW.getTime() + 30 * 1000);
    expect(reminderMinutesFor(soon, NOW, 1440)).toBe(0);
  });

  it("declines entirely once the event has started — there is nothing left to warn about", () => {
    expect(reminderMinutesFor(inHours(-1), NOW, 1440)).toBeUndefined();
    expect(reminderMinutesFor(NOW, NOW, 1440)).toBeUndefined();
  });

  it("respects Google's own ceiling on a reminder override", () => {
    // Asking for more than 28 days is rejected by the API, so the clamp has to know the bound.
    expect(reminderMinutesFor(inHours(24 * 60), NOW, 99_999)).toBe(40320);
  });

  it("honours a zero lead: tell me when it starts", () => {
    expect(reminderMinutesFor(inHours(5), NOW, 0)).toBe(0);
  });
});

describe("calendarWindow", () => {
  it("is the SAME block the driver-availability pad reserves", () => {
    // Half the configured gap on each side — so the hour the system refuses to double-book is
    // exactly the hour that appears in the calendar.
    const at = new Date("2026-08-02T14:00:00.000Z");
    expect(calendarWindow(at, "DELIVERY", 60)).toEqual({
      start: new Date("2026-08-02T13:30:00.000Z"),
      end: new Date("2026-08-02T14:30:00.000Z"),
    });
  });

  it("rounds an odd gap UP, like the pad does", () => {
    const at = new Date("2026-08-02T14:00:00.000Z");
    const { start, end } = calendarWindow(at, "DELIVERY", 45);
    expect(end.getTime() - start.getTime()).toBe(46 * 60 * 1000);
  });
});

describe("calendarSequence", () => {
  it("is stable for an unchanged order, so a refresh is not read as a change", () => {
    expect(calendarSequence(order())).toBe(0);
  });

  it("grows as the order is rewritten", () => {
    const edited = order({ updatedAt: new Date("2026-08-01T09:30:00.000Z") });
    expect(calendarSequence(edited)).toBe(150);
  });
});

describe("calendarEntriesFor", () => {
  const options = { gapMinutes: 60, reminderMinutes: 1440, now: NOW };

  it("builds one entry per event the order still has to perform", () => {
    const entries = calendarEntriesFor(order(), options);
    expect(entries.map((entry) => entry.kind)).toEqual(["DELIVERY", "COLLECTION"]);
    // The kind leads (it is what you scan for when three jobs share a day), the client's name
    // identifies it — deliberately not the order number, which means nothing at a glance.
    expect(entries[0]?.summary).toBe("calendar.kinds.DELIVERY · María López");
    expect(entries[0]?.location).toBe("Zona 10, 4a avenida 5-55");
  });

  it("drops a step that already HAPPENED — being reminded of finished work is absurd", () => {
    // Read off the ACTUALS, exactly like the logistics pad, so a rewind puts the entry back by
    // itself with no status id anywhere.
    const entries = calendarEntriesFor(
      order({ deliveredAt: new Date("2026-08-02T14:05:00.000Z") }),
      options,
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["COLLECTION"]);
  });

  it("gives a purchase-only order its delivery alone", () => {
    expect(calendarEntriesFor(order({ pickupAt: null }), options)).toHaveLength(1);
  });

  it("gives a CANCELLED order nothing at all", () => {
    // Which is what makes the feed self-cleaning: the entry simply stops being emitted.
    expect(
      calendarEntriesFor(order({ cancelledAt: new Date() }), options),
    ).toHaveLength(0);
  });

  it("omits the location when the order carries no address text", () => {
    const [entry] = calendarEntriesFor(order({ address: "" }), options);
    expect(entry?.location).toBeUndefined();
  });

  it("omits the reminder on an event that has already begun", () => {
    const past = calendarEntriesFor(
      order({ deliveryAt: new Date("2026-07-01T14:00:00.000Z"), pickupAt: null }),
      options,
    );
    expect(past[0]?.reminderMinutes).toBeUndefined();
  });
});

describe("ICS serialisation", () => {
  it("writes UTC instants with no separators", () => {
    expect(icsDate(new Date("2026-08-01T14:00:00.000Z"))).toBe("20260801T140000Z");
  });

  it("escapes in the ORDER that does not double-escape its own escapes", () => {
    // Backslash first, or every `;` we escape next would come back as `\\;`.
    expect(icsEscape("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });

  it("folds by OCTETS, not characters — an accent is two bytes", () => {
    // A parser measures the file, not our arithmetic: counting characters emits lines that are
    // legal by our count and over the limit on disk, which strict clients reject outright.
    const line = `SUMMARY:${"á".repeat(60)}`;
    const folded = icsFold(line);
    expect(folded).toContain("\r\n ");
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
  });

  it("leaves a short line alone", () => {
    expect(icsFold("SUMMARY:corto")).toBe("SUMMARY:corto");
  });

  it("emits an alarm only when there is a reminder to give", () => {
    const [withReminder] = calendarEntriesFor(order(), {
      gapMinutes: 60,
      reminderMinutes: 1440,
      now: NOW,
    });
    expect(icsEvent(withReminder!, NOW)).toContain("TRIGGER:-PT1440M");

    const [past] = calendarEntriesFor(
      order({ deliveryAt: new Date("2026-07-01T14:00:00.000Z"), pickupAt: null }),
      { gapMinutes: 60, reminderMinutes: 1440, now: NOW },
    );
    expect(icsEvent(past!, NOW).join("\n")).not.toContain("VALARM");
  });

  it("builds a calendar that asks to be refreshed, and closes every block it opens", () => {
    const entries = calendarEntriesFor(order(), {
      gapMinutes: 60,
      reminderMinutes: 1440,
      now: NOW,
    });
    const ics = buildIcs(entries, { name: "Agenda", stamp: NOW });

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    // CRLF is required by RFC 5545 — some parsers reject bare LF outright.
    expect(ics.includes("\n") && !ics.includes("\r\n")).toBe(false);
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT15M");
    expect(ics.match(/BEGIN:VEVENT/gu)).toHaveLength(2);
    expect(ics.match(/END:VEVENT/gu)).toHaveLength(2);
    // The UID is the deterministic entry id, so a refresh updates rather than duplicating.
    expect(ics).toContain("UID:orden12d@ozari");
  });

  it("omits LOCATION when there is none, rather than printing an empty field", () => {
    const entries = calendarEntriesFor(order({ address: "" }), {
      gapMinutes: 60,
      reminderMinutes: 1440,
      now: NOW,
    });
    expect(buildIcs(entries, { name: "Agenda", stamp: NOW })).not.toContain("LOCATION:");
  });
});
