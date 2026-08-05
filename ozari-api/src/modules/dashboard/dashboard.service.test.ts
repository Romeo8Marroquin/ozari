import { beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { encryptKms } from "@helpers/encryption.js";
import { encodeCoords } from "@helpers/geo.js";
import { makeProjectionContext } from "@/tests/fixtures/lifecycleCatalog.js";
import {
  TREND_MONTHS,
  UP_NEXT_LIMIT,
  bucketRevenueByMonth,
  compare,
  dayRange,
  monthKey,
  monthRange,
  nextPendingEvent,
  outstandingFrom,
  percentDelta,
  projectUpNextItem,
  round2,
  selectUpNext,
  trailingMonthKeys,
  type DashboardOrderRow,
} from "./dashboard.service.js";

const VALID_ENCRYPTION_KEY =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] = VALID_ENCRYPTION_KEY;
});

const DELIVERY_AT = new Date("2026-08-01T14:00:00Z");
const PICKUP_AT = new Date("2026-08-02T10:00:00Z");

const makeRow = (overrides: Partial<DashboardOrderRow> = {}): DashboardOrderRow => ({
  id: 7,
  userId: null,
  clientRegistryId: 3,
  deliveryNameKms: encryptKms("María López"),
  deliveryContactKms: encryptKms("5555-1234"),
  deliveryAddressKms: encryptKms("Zona 10, 4a avenida 5-55"),
  deliveryCoordsKms: null,
  deliveryInstructionsKms: null,
  description: null,
  eventTypeId: 1,
  deliveryAt: DELIVERY_AT,
  pickupAt: PICKUP_AT,
  deliveredAt: null,
  collectedAt: null,
  readyAt: null,
  serviceStart: DELIVERY_AT,
  serviceEnd: PICKUP_AT,
  assignedUserId: 1,
  totalAmount: new Prisma.Decimal("450.00"),
  deliveryAmount: null,
  depositAmount: null,
  discountAmount: null,
  discountReason: null,
  paidAt: null,
  cancelledAt: null,
  cancelReason: null,
  currencyId: 1,
  serviceStatusId: 1,
  paymentStatusId: 1,
  paymentMethodId: null,
  comment: null,
  invoiceNumberKms: null,
  isActive: true,
  updatedAt: null,
  createdAt: new Date("2026-07-16T12:00:00Z"),
  eventType: { id: 1, name: "Evento familiar" },
  serviceStatus: { id: 1, name: "Pendiente" },
  paymentStatus: { id: 1, name: "Pendiente" },
  currency: { id: 1, iso4217Code: "GTQ", name: "Quetzal", symbol: "Q" },
  assignedUser: null,
  serviceDetails: [{ quantity: 2, isRental: true }],
  ...overrides,
});

/** A schedule-shaped order, the only thing `nextPendingEvent` reads. */
const schedule = (overrides: Partial<Parameters<typeof nextPendingEvent>[0]> = {}) => ({
  deliveryAt: DELIVERY_AT,
  pickupAt: PICKUP_AT,
  deliveredAt: null,
  collectedAt: null,
  cancelledAt: null,
  ...overrides,
});

describe("period ranges", () => {
  // Local Y/M/D construction, so the assertions use local components too — the business is
  // single-timezone and the boundaries are deliberately local (see `monthRange`).
  const now = new Date(2026, 7, 15, 9, 30); // 15 Aug 2026, local

  it("monthRange is the half-open calendar month containing `now`", () => {
    expect(monthRange(now)).toEqual({
      from: new Date(2026, 7, 1),
      to: new Date(2026, 8, 1),
    });
  });

  it("monthRange walks backwards across a year boundary", () => {
    // -8 months from August 2026 is December 2025 — the rollover the Date constructor handles for us.
    expect(monthRange(now, -8)).toEqual({
      from: new Date(2025, 11, 1),
      to: new Date(2026, 0, 1),
    });
  });

  it("dayRange is the half-open local day", () => {
    expect(dayRange(now)).toEqual({
      from: new Date(2026, 7, 15),
      to: new Date(2026, 7, 16),
    });
  });

  it("monthKey zero-pads the month so keys sort lexicographically", () => {
    expect(monthKey(new Date(2026, 0, 31))).toBe("2026-01");
    expect(monthKey(new Date(2026, 11, 1))).toBe("2026-12");
  });

  it("trailingMonthKeys ends on the current month, oldest first, crossing the year", () => {
    expect(trailingMonthKeys(now, 3)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(trailingMonthKeys(new Date(2026, 1, 5), 4)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("percentDelta / compare", () => {
  it("is the signed change, rounded to one decimal", () => {
    expect(percentDelta(150, 100)).toBe(50);
    expect(percentDelta(80, 100)).toBe(-20);
    expect(percentDelta(1, 3)).toBe(-66.7);
  });

  it("is ABSENT when the previous period was zero — a growth % from nothing is a lie", () => {
    expect(percentDelta(500, 0)).toBeUndefined();
    expect(percentDelta(0, 0)).toBeUndefined();
  });

  it("compare pairs the two figures and omits the delta rather than sending null", () => {
    expect(compare(150, 100)).toEqual({ current: 150, previous: 100, deltaPercent: 50 });
    expect(compare(150, 0)).toEqual({ current: 150, previous: 0 });
    expect(compare(150, 0)).not.toHaveProperty("deltaPercent");
  });
});

describe("nextPendingEvent", () => {
  it("is the delivery while the order has not been delivered", () => {
    expect(nextPendingEvent(schedule())).toEqual({ at: DELIVERY_AT, kind: "DELIVERY" });
  });

  it("becomes the COLLECTION the moment the delivery is confirmed", () => {
    expect(nextPendingEvent(schedule({ deliveredAt: new Date() }))).toEqual({
      at: PICKUP_AT,
      kind: "COLLECTION",
    });
  });

  it("is null once everything owed has happened", () => {
    expect(
      nextPendingEvent(schedule({ deliveredAt: new Date(), collectedAt: new Date() })),
    ).toBeNull();
  });

  it("is null for a cancelled order — nothing it lists will be performed", () => {
    expect(nextPendingEvent(schedule({ cancelledAt: new Date() }))).toBeNull();
  });

  it("is null for a purchase-only order already delivered (no pickup exists)", () => {
    expect(
      nextPendingEvent(schedule({ pickupAt: null, deliveredAt: new Date() })),
    ).toBeNull();
  });

  it("takes the EARLIEST pending event even when the columns are out of order", () => {
    // Defensive: a corrected pickup earlier than its delivery must not park the order behind it.
    expect(
      nextPendingEvent(
        schedule({ deliveryAt: PICKUP_AT, pickupAt: DELIVERY_AT }),
      ),
    ).toEqual({ at: DELIVERY_AT, kind: "COLLECTION" });
  });
});

describe("selectUpNext", () => {
  const at = (iso: string) => ({ at: new Date(iso), kind: "DELIVERY" as const });

  it("orders by the next event and caps the queue", () => {
    const rows = [
      { id: 1, when: "2026-08-01T16:00:00Z" },
      { id: 2, when: "2026-08-01T09:00:00Z" },
      { id: 3, when: "2026-08-01T12:00:00Z" },
      { id: 4, when: "2026-08-01T08:00:00Z" },
    ];
    const picked = selectUpNext(rows, (row) => at(row.when), UP_NEXT_LIMIT);
    expect(picked.map((p) => p.row.id)).toEqual([4, 2, 3]);
  });

  it("drops rows with nothing pending instead of showing an empty slot", () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const picked = selectUpNext(
      rows,
      (row) => (row.id === 2 ? null : at("2026-08-01T09:00:00Z")),
      UP_NEXT_LIMIT,
    );
    expect(picked.map((p) => p.row.id)).toEqual([1, 3]);
  });

  it("breaks ties on id so the queue does not reshuffle on every refetch", () => {
    const rows = [{ id: 9 }, { id: 4 }];
    const picked = selectUpNext(rows, () => at("2026-08-01T09:00:00Z"), UP_NEXT_LIMIT);
    expect(picked.map((p) => p.row.id)).toEqual([4, 9]);
  });
});

describe("projectUpNextItem", () => {
  const event = { at: DELIVERY_AT, kind: "DELIVERY" as const };

  it("extends the ORDER LIST item, so actions come from the same engine as the agenda", () => {
    const item = projectUpNextItem(
      makeRow(),
      event,
      makeProjectionContext(),
      new Date("2026-08-01T13:30:00Z"),
    );
    expect(item).toMatchObject({
      id: 7,
      clientName: "María López",
      status: { id: 1, name: "Pendiente", colorKey: "amber" },
      deliveryAddress: "Zona 10, 4a avenida 5-55",
      deliveryContact: "5555-1234",
    });
    expect(item.actions.length).toBeGreaterThan(0);
  });

  it("counts down in whole minutes against the payload's instant, not the browser's", () => {
    const item = projectUpNextItem(
      makeRow(),
      event,
      makeProjectionContext(),
      new Date("2026-08-01T13:30:00Z"),
    );
    expect(item.event).toMatchObject({ kind: "DELIVERY", isOverdue: false, minutesUntil: 30 });
  });

  it("flags an event whose time has passed, with a negative countdown", () => {
    const item = projectUpNextItem(
      makeRow(),
      event,
      makeProjectionContext(),
      new Date("2026-08-01T14:45:00Z"),
    );
    expect(item.event).toMatchObject({ isOverdue: true, minutesUntil: -45 });
  });

  it("carries the pin and the arrival instructions when the order has them", () => {
    const item = projectUpNextItem(
      makeRow({
        // ENCRYPTED then encoded, as the column actually stores it. The dashboard used to decode the
        // raw ciphertext (skipping `decryptKms`), which `decodeCoords` totally rejected — so a
        // pinned order silently showed no pin at all. It reads the pin through the LIST projection
        // now, which is the one place that decrypt/decode pair lives.
        deliveryCoordsKms: encryptKms(encodeCoords({ lat: 14.634915, lng: -90.506883 })),
        deliveryInstructionsKms: encryptKms("Portón negro"),
      }),
      event,
      makeProjectionContext(),
      DELIVERY_AT,
    );
    expect(item.deliveryCoords).toEqual({ lat: 14.634915, lng: -90.506883 });
    expect(item.deliveryInstructions).toBe("Portón negro");
  });

  it("has no pin and no instructions when the order carries neither", () => {
    const item = projectUpNextItem(makeRow(), event, makeProjectionContext(), DELIVERY_AT);
    // `deliveryCoords` is now inherited from the LIST projection, which always emits the key (as
    // `undefined`) so every surface reads the pin the same way; the instructions stay omitted.
    expect(item.deliveryCoords).toBeUndefined();
    expect(item).not.toHaveProperty("deliveryInstructions");
  });
});

describe("bucketRevenueByMonth", () => {
  const now = new Date(2026, 7, 15);
  const row = (year: number, month: number, amount: string) => ({
    deliveryAt: new Date(year, month, 10),
    totalAmount: new Prisma.Decimal(amount),
  });

  it("returns one bucket per month, oldest first, with empty months as explicit zeros", () => {
    const series = bucketRevenueByMonth([row(2026, 7, "100")], now, TREND_MONTHS);
    expect(series).toHaveLength(TREND_MONTHS);
    expect(series[0]?.month).toBe("2025-09");
    expect(series.at(-1)).toEqual({ month: "2026-08", revenue: 100, orders: 1 });
    // A month with no business is a zero bar, never a missing one.
    expect(series[0]).toEqual({ month: "2025-09", revenue: 0, orders: 0 });
  });

  it("sums several orders into the same month without float drift", () => {
    const series = bucketRevenueByMonth(
      [row(2026, 6, "1234.56"), row(2026, 6, "0.01"), row(2026, 6, "0.01")],
      now,
      TREND_MONTHS,
    );
    expect(series.find((point) => point.month === "2026-07")).toEqual({
      month: "2026-07",
      revenue: 1234.58,
      orders: 3,
    });
  });

  it("ignores a row outside the window rather than inventing a 13th bar", () => {
    const series = bucketRevenueByMonth([row(2020, 0, "999")], now, TREND_MONTHS);
    expect(series).toHaveLength(TREND_MONTHS);
    expect(series.every((point) => point.revenue === 0)).toBe(true);
  });
});

describe("outstandingFrom", () => {
  const row = (total: string, deposit: string | null) => ({
    totalAmount: new Prisma.Decimal(total),
    depositAmount: deposit === null ? null : new Prisma.Decimal(deposit),
  });

  it("sums what is still owed, net of deposits", () => {
    expect(outstandingFrom([row("450.00", null), row("300.00", "100.00")])).toEqual({
      amount: 650,
      orders: 2,
    });
  });

  it("skips a fully-covered order instead of counting a zero balance as a debt", () => {
    expect(outstandingFrom([row("200.00", "200.00")])).toEqual({ amount: 0, orders: 0 });
  });

  it("clamps a deposit larger than the total — a slip must not shrink the headline figure", () => {
    expect(outstandingFrom([row("100.00", "250.00"), row("400.00", null)])).toEqual({
      amount: 400,
      orders: 1,
    });
  });

  it("is zero for no rows", () => {
    expect(outstandingFrom([])).toEqual({ amount: 0, orders: 0 });
  });
});

describe("round2", () => {
  it("keeps money at cents", () => {
    expect(round2(1234.5600000000002)).toBe(1234.56);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});
