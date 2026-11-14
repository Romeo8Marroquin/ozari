import { describe, expect, it } from "vitest";
import {
  businessDayRange,
  businessMonthKey,
  businessMonthRange,
  formatBusinessTime,
  trailingBusinessMonthKeys,
  zonedMidnight,
  zonedParts,
} from "./businessTime.js";

// Every instant is written in UTC: these must hold on a developer's machine in Guatemala AND on
// Cloud Run (UTC) — the gap between the two is exactly the production bug this helper fixes.

describe("zonedParts", () => {
  it("reads the wall clock in the business zone (Guatemala, UTC−6)", () => {
    expect(zonedParts(new Date("2026-11-14T02:30:45Z"))).toEqual({
      year: 2026,
      month: 11,
      day: 13,
      hour: 20,
      minute: 30,
      second: 45,
    });
  });

  it("midnight reads as hour 0, never 24", () => {
    expect(zonedParts(new Date("2026-11-13T06:00:00Z")).hour).toBe(0);
  });
});

describe("zonedMidnight", () => {
  it("is 06:00Z for a Guatemala date, and overflows like Date.UTC", () => {
    expect(zonedMidnight(2026, 10, 13)).toEqual(new Date("2026-11-13T06:00:00Z"));
    expect(zonedMidnight(2026, 11, 32)).toEqual(new Date("2027-01-01T06:00:00Z"));
    expect(zonedMidnight(2026, -1, 1)).toEqual(new Date("2025-12-01T06:00:00Z"));
  });

  it("lands on the right midnight across a DST change (zone-agnostic, though Guatemala has none)", () => {
    // New York springs forward on 8 Mar 2026: midnight that day is still EST (−5).
    expect(zonedMidnight(2026, 2, 8, "America/New_York")).toEqual(
      new Date("2026-03-08T05:00:00Z"),
    );
    // …and the next midnight is EDT (−4).
    expect(zonedMidnight(2026, 2, 9, "America/New_York")).toEqual(
      new Date("2026-03-09T04:00:00Z"),
    );
  });
});

describe("businessDayRange / businessMonthRange", () => {
  it("today spans the business's 00:00 → 24:00, wherever the server is", () => {
    // 20:30 on the 13th in Guatemala — already the 14th in UTC.
    expect(businessDayRange(new Date("2026-11-14T02:30:00Z"))).toEqual({
      from: new Date("2026-11-13T06:00:00Z"),
      to: new Date("2026-11-14T06:00:00Z"),
    });
  });

  it("the month is the business month, shifted by an offset", () => {
    const evening = new Date("2026-12-01T02:30:00Z"); // 30 Nov, 20:30 in Guatemala
    expect(businessMonthRange(evening)).toEqual({
      from: new Date("2026-11-01T06:00:00Z"),
      to: new Date("2026-12-01T06:00:00Z"),
    });
    expect(businessMonthRange(evening, -1)).toEqual({
      from: new Date("2026-10-01T06:00:00Z"),
      to: new Date("2026-11-01T06:00:00Z"),
    });
  });
});

describe("month keys", () => {
  it("keys an instant by its business month, zero-padded", () => {
    expect(businessMonthKey(new Date("2026-12-01T02:30:00Z"))).toBe("2026-11");
    expect(businessMonthKey(new Date("2026-02-10T12:00:00Z"))).toBe("2026-02");
  });

  it("trails back from the business month, crossing the year", () => {
    // 31 Dec 2026, 20:00 in Guatemala — the UTC date is already January.
    expect(trailingBusinessMonthKeys(new Date("2027-01-01T02:00:00Z"), 3)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
  });
});

describe("formatBusinessTime", () => {
  it("formats in the business zone, not the server's", () => {
    // Normalise the locale's spacing/punctuation variants ("8:30 p. m." with NBSPs).
    const text = formatBusinessTime(new Date("2026-11-14T02:30:00Z")).replace(/\s/gu, " ");
    expect(text).toMatch(/^8:30 p\. ?m\.$/u);
  });
});
