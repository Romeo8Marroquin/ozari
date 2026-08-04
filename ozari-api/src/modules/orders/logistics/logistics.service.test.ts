import { beforeAll, describe, expect, it, vi } from "vitest";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { decryptKms, encryptKms } from "@helpers/encryption.js";
import {
  OrderDriverConflictError,
  OrderSelfOverlapError,
  assertDriverAvailable,
  buildDriverConflictWhere,
  eventsOverlap,
  findDriverConflicts,
  logisticsEvents,
  maxPadMinutes,
  padMinutesFor,
  pendingLogisticsEvents,
  upcomingLogisticsEvents,
  projectDriverAvailability,
  refineConflicts,
  selfOverlap,
} from "./logistics.service.js";
import type { LogisticsEventModel } from "./logistics.models.js";

// The driver's name is encrypted at rest, so the candidate fixtures need a real key.
beforeAll(() => {
  process.env["ENCRYPTION_KEY"] =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
});

const at = (iso: string): Date => new Date(iso);
const delivery = (iso: string): LogisticsEventModel => ({
  at: at(iso),
  kind: "DELIVERY",
});
const collection = (iso: string): LogisticsEventModel => ({
  at: at(iso),
  kind: "COLLECTION",
});

/** A driver's day as the widened candidate query returns it. Actuals unstamped by default: the
 *  events are still to be performed, so they still occupy the day. */
const candidate = (
  id: number,
  deliveryAt: string,
  pickupAt?: string,
  performed: { deliveredAt?: string; collectedAt?: string } = {},
) => ({
  id,
  deliveryAt: at(deliveryAt),
  pickupAt: pickupAt ? at(pickupAt) : null,
  deliveredAt: performed.deliveredAt ? at(performed.deliveredAt) : null,
  collectedAt: performed.collectedAt ? at(performed.collectedAt) : null,
  assignedUser: { fullNameKms: encryptKms("Ana Ruiz") },
});

describe("logisticsEvents", () => {
  it("a rental order occupies TWO moments of its driver's day", () => {
    expect(
      logisticsEvents({
        deliveryAt: at("2026-08-01T14:00:00Z"),
        pickupAt: at("2026-08-02T10:00:00Z"),
      }),
    ).toEqual([
      { at: at("2026-08-01T14:00:00Z"), kind: "DELIVERY" },
      { at: at("2026-08-02T10:00:00Z"), kind: "COLLECTION" },
    ]);
  });

  it("a purchase-only order has no collection — from a null column or an absent field alike", () => {
    const fromRow = logisticsEvents({
      deliveryAt: at("2026-08-01T14:00:00Z"),
      pickupAt: null,
    });
    const fromBody = logisticsEvents({ deliveryAt: at("2026-08-01T14:00:00Z") });
    expect(fromRow).toEqual([{ at: at("2026-08-01T14:00:00Z"), kind: "DELIVERY" }]);
    expect(fromBody).toEqual(fromRow);
  });
});

describe("pendingLogisticsEvents", () => {
  it("keeps every event of an order that has performed nothing yet", () => {
    expect(
      pendingLogisticsEvents({
        deliveryAt: at("2026-08-01T14:00:00Z"),
        pickupAt: at("2026-08-02T10:00:00Z"),
      }),
    ).toEqual([
      { at: at("2026-08-01T14:00:00Z"), kind: "DELIVERY" },
      { at: at("2026-08-02T10:00:00Z"), kind: "COLLECTION" },
    ]);
  });

  it("drops the events that already HAPPENED — read from the actuals, never a status id", () => {
    // Delivered but not collected: the delivery is history, the collection is still a promise.
    expect(
      pendingLogisticsEvents({
        deliveryAt: at("2026-08-01T14:00:00Z"),
        pickupAt: at("2026-08-02T10:00:00Z"),
        deliveredAt: at("2026-08-01T14:05:00Z"),
      }),
    ).toEqual([{ at: at("2026-08-02T10:00:00Z"), kind: "COLLECTION" }]);
  });

  it("a finished order occupies nothing — both actuals stamped", () => {
    expect(
      pendingLogisticsEvents({
        deliveryAt: at("2026-08-01T14:00:00Z"),
        pickupAt: at("2026-08-02T10:00:00Z"),
        deliveredAt: at("2026-08-01T14:05:00Z"),
        collectedAt: at("2026-08-02T10:10:00Z"),
      }),
    ).toEqual([]);
  });

  it("a CANCELLED order occupies nothing, however unstamped its events are", () => {
    // It will never be performed, so it neither blocks anyone nor can be blocked — which is what
    // makes editing one pure paperwork.
    expect(
      pendingLogisticsEvents({
        deliveryAt: at("2026-08-01T14:00:00Z"),
        pickupAt: at("2026-08-02T10:00:00Z"),
        cancelledAt: at("2026-07-20T10:00:00Z"),
      }),
    ).toEqual([]);
  });
});

describe("upcomingLogisticsEvents", () => {
  const now = at("2026-08-01T12:00:00Z");

  it("checks only what is still AHEAD — the past is a record, not a schedule", () => {
    // Rewinding a long-finished order must never be refused: the admin cannot move time, so a clash
    // between two past events would be a dead end with no possible correction.
    expect(
      upcomingLogisticsEvents(
        {
          deliveryAt: at("2026-07-30T14:00:00Z"),
          pickupAt: at("2026-08-02T10:00:00Z"),
        },
        now,
      ),
    ).toEqual([{ at: at("2026-08-02T10:00:00Z"), kind: "COLLECTION" }]);
  });

  it("has nothing to check once every event is behind us", () => {
    expect(
      upcomingLogisticsEvents(
        { deliveryAt: at("2026-07-30T14:00:00Z"), pickupAt: at("2026-07-31T10:00:00Z") },
        now,
      ),
    ).toEqual([]);
  });

  it("still drops what already happened, and everything when cancelled", () => {
    expect(
      upcomingLogisticsEvents(
        {
          deliveryAt: at("2026-08-01T14:00:00Z"),
          pickupAt: at("2026-08-02T10:00:00Z"),
          collectedAt: at("2026-08-01T09:00:00Z"),
        },
        now,
      ),
    ).toEqual([{ at: at("2026-08-01T14:00:00Z"), kind: "DELIVERY" }]);
    expect(
      upcomingLogisticsEvents(
        { deliveryAt: at("2026-08-01T14:00:00Z"), cancelledAt: now },
        now,
      ),
    ).toEqual([]);
  });
});

describe("padMinutesFor", () => {
  it("splits the admin's ONE setting into half on each side, so two events need the full gap", () => {
    expect(padMinutesFor(delivery("2026-08-01T14:00:00Z"), 60)).toEqual({
      before: 30,
      after: 30,
    });
  });

  it("rounds the PAD up on an odd gap — never less distance than the admin asked for", () => {
    // 45 ⇒ 23 per side ⇒ 46 minutes of effective distance, not 44.
    expect(padMinutesFor(collection("2026-08-01T14:00:00Z"), 45)).toEqual({
      before: 23,
      after: 23,
    });
    expect(maxPadMinutes(45)).toBe(23);
  });

  it("pads the same regardless of the event's kind TODAY — the argument is the door, not a rule", () => {
    expect(padMinutesFor(delivery("2026-08-01T14:00:00Z"), 60)).toEqual(
      padMinutesFor(collection("2026-08-01T14:00:00Z"), 60),
    );
  });
});

describe("eventsOverlap", () => {
  const base = delivery("2026-08-01T14:00:00Z");

  it("blocks anything closer than the gap, in either direction", () => {
    expect(eventsOverlap(base, delivery("2026-08-01T14:30:00Z"), 60)).toBe(true);
    expect(eventsOverlap(base, collection("2026-08-01T13:30:00Z"), 60)).toBe(true);
  });

  it("touching blocks do NOT overlap — exactly the gap apart is allowed", () => {
    expect(eventsOverlap(base, delivery("2026-08-01T15:00:00Z"), 60)).toBe(false);
    expect(eventsOverlap(base, delivery("2026-08-01T13:00:00Z"), 60)).toBe(false);
  });
});

describe("buildDriverConflictWhere", () => {
  const events = [delivery("2026-08-01T14:00:00Z")];

  it("scopes the day to ONE driver — the whole point of the reframing", () => {
    const where = buildDriverConflictWhere(events, { gapMinutes: 60, driverId: 2 });
    expect(where).toEqual({
      isActive: true,
      cancelledAt: null,
      assignedUserId: 2,
      OR: [
        { deliveryAt: { gt: at("2026-08-01T13:00:00Z"), lt: at("2026-08-01T15:00:00Z") } },
        { pickupAt: { gt: at("2026-08-01T13:00:00Z"), lt: at("2026-08-01T15:00:00Z") } },
      ],
    });
  });

  it("a SECOND driver is a different query — one driver's day never blocks another's", () => {
    // The test that proves the reframing did something: same events, same instant, two people.
    const ana = buildDriverConflictWhere(events, { gapMinutes: 60, driverId: 2 });
    const luis = buildDriverConflictWhere(events, { gapMinutes: 60, driverId: 3 });
    expect(ana["assignedUserId"]).toBe(2);
    expect(luis["assignedUserId"]).toBe(3);
    // Nothing else differs: two drivers CAN be in two places at the same minute (Q-D1). If the
    // van is the real constraint, that is the vehicles door — not this rule.
    expect({ ...ana, assignedUserId: undefined }).toEqual({
      ...luis,
      assignedUserId: undefined,
    });
  });

  it("widens by the MAXIMUM pad on both sides, never by less", () => {
    // An odd gap: pads are 23 per side, so candidates must be selected out to 46 minutes — the
    // over-selection §5 depends on. Under-selecting would silently miss real conflicts.
    const where = buildDriverConflictWhere(events, { gapMinutes: 45, driverId: 2 });
    expect(where.OR).toEqual([
      { deliveryAt: { gt: at("2026-08-01T13:14:00Z"), lt: at("2026-08-01T14:46:00Z") } },
      { pickupAt: { gt: at("2026-08-01T13:14:00Z"), lt: at("2026-08-01T14:46:00Z") } },
    ]);
  });

  it("checks BOTH event columns for every event, and drops the order being edited", () => {
    const where = buildDriverConflictWhere(
      [delivery("2026-08-01T14:00:00Z"), collection("2026-08-02T10:00:00Z")],
      { gapMinutes: 60, driverId: 2, excludeServiceId: 12 },
    );
    expect((where.OR as unknown[]).length).toBe(4);
    expect(where["id"]).toEqual({ not: 12 });
  });
});

describe("refineConflicts", () => {
  const events = [delivery("2026-08-01T14:00:00Z")];

  it("names the other order's event AND which of ours it blocks", () => {
    expect(
      refineConflicts([candidate(9, "2026-07-30T09:00:00Z", "2026-08-01T14:20:00Z")], events, 60),
    ).toEqual([
      {
        orderId: 9,
        at: at("2026-08-01T14:20:00Z"),
        kind: "COLLECTION",
        blocks: "DELIVERY",
      },
    ]);
  });

  it("drops a candidate the SQL over-selected but the pads clear", () => {
    // Exactly the gap away: the widened query returns it, the pads say it is fine. Today that is
    // the odd-gap rounding; tomorrow it is a nearby stop whose travel time is 12 minutes.
    expect(refineConflicts([candidate(9, "2026-08-01T15:00:00Z")], events, 60)).toEqual([]);
  });

  it("ignores a candidate's event that has already been performed", () => {
    // Same clash as above, but their delivery is done — the driver is free again at that hour.
    expect(
      refineConflicts(
        [candidate(9, "2026-08-01T14:20:00Z", undefined, { deliveredAt: "2026-08-01T14:25:00Z" })],
        events,
        60,
      ),
    ).toEqual([]);
  });

  it("reports every colliding PAIR, so nothing is hidden behind the first one", () => {
    const both = refineConflicts(
      [candidate(9, "2026-08-01T14:10:00Z"), candidate(10, "2026-08-02T10:05:00Z")],
      [delivery("2026-08-01T14:00:00Z"), collection("2026-08-02T10:00:00Z")],
      60,
    );
    expect(both.map((conflict) => conflict.orderId)).toEqual([9, 10]);
    expect(both.map((conflict) => conflict.blocks)).toEqual(["DELIVERY", "COLLECTION"]);
  });
});

describe("selfOverlap", () => {
  it("catches an order whose own delivery and collection are too close (§3.1)", () => {
    expect(
      selfOverlap(
        [delivery("2026-08-01T14:00:00Z"), collection("2026-08-01T14:15:00Z")],
        60,
      ),
    ).toBe(true);
  });

  it("a normal rental window and a purchase-only order are both fine", () => {
    expect(
      selfOverlap(
        [delivery("2026-08-01T14:00:00Z"), collection("2026-08-02T10:00:00Z")],
        60,
      ),
    ).toBe(false);
    expect(selfOverlap([delivery("2026-08-01T14:00:00Z")], 60)).toBe(false);
  });
});

describe("findDriverConflicts", () => {
  const client = (rows: ReturnType<typeof candidate>[]) => ({
    service: { findMany: vi.fn().mockResolvedValue(rows) },
  });

  it("widens in SQL, refines in code, and decrypts who is busy", async () => {
    const prisma = client([candidate(9, "2026-08-01T14:30:00Z")]);
    await expect(
      findDriverConflicts(prisma, [delivery("2026-08-01T14:00:00Z")], {
        gapMinutes: 60,
        driverId: 2,
      }),
    ).resolves.toEqual({
      conflicts: [
        {
          orderId: 9,
          at: at("2026-08-01T14:30:00Z"),
          kind: "DELIVERY",
          blocks: "DELIVERY",
        },
      ],
      driverName: "Ana Ruiz",
    });
    expect(prisma.service.findMany).toHaveBeenCalledTimes(1);
  });

  it("an empty day has no conflicts and nobody to name", async () => {
    await expect(
      findDriverConflicts(client([]), [delivery("2026-08-01T14:00:00Z")], {
        gapMinutes: 60,
        driverId: 2,
      }),
    ).resolves.toEqual({ conflicts: [], driverName: undefined });
  });

  it("asks NOTHING when the order has no pending events at all", async () => {
    // A cancelled or finished order occupies no day, so there is no question to ask — and an empty
    // `OR` must never reach Prisma, where it does not mean "match anything".
    const prisma = client([]);
    await expect(
      findDriverConflicts(prisma, [], { gapMinutes: 60, driverId: 2 }),
    ).resolves.toEqual({ conflicts: [], driverName: undefined });
    expect(prisma.service.findMany).not.toHaveBeenCalled();
  });
});

describe("assertDriverAvailable", () => {
  const client = (rows: ReturnType<typeof candidate>[]) => ({
    service: { findMany: vi.fn().mockResolvedValue(rows) },
  });

  it("passes when the driver's day is clear", async () => {
    await expect(
      assertDriverAvailable(client([]), [delivery("2026-08-01T14:00:00Z")], {
        gapMinutes: 60,
        driverId: 2,
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses the order's own colliding events BEFORE touching the database", async () => {
    const prisma = client([]);
    await expect(
      assertDriverAvailable(
        prisma,
        [delivery("2026-08-01T14:00:00Z"), collection("2026-08-01T14:15:00Z")],
        { gapMinutes: 60, driverId: 2 },
      ),
    ).rejects.toBeInstanceOf(OrderSelfOverlapError);
    expect(prisma.service.findMany).not.toHaveBeenCalled();
  });

  it("throws the FIRST real conflict, carrying everything the form needs", async () => {
    const error = await assertDriverAvailable(
      client([candidate(9, "2026-08-01T14:30:00Z")]),
      [delivery("2026-08-01T14:00:00Z")],
      { gapMinutes: 60, driverId: 2 },
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(OrderDriverConflictError);
    const conflict = error as OrderDriverConflictError;
    expect(conflict.conflict.orderId).toBe(9);
    expect(conflict.driverName).toBe("Ana Ruiz");
    expect(conflict.gapMinutes).toBe(60);
  });
});

describe("projectDriverAvailability", () => {
  const conflicts = [
    {
      orderId: 9,
      at: at("2026-08-01T14:30:00Z"),
      kind: "DELIVERY" as const,
      blocks: "DELIVERY" as const,
    },
  ];

  it("gives the ADMIN the whole picture — which order, when, who, and the configured gap", () => {
    expect(
      projectDriverAvailability(
        { role: RolesEnum.Admin },
        { conflicts, selfOverlap: false, gapMinutes: 60, driverName: "Ana Ruiz" },
      ),
    ).toEqual({
      available: false,
      gapMinutes: 60,
      selfOverlap: false,
      conflicts,
      driverName: "Ana Ruiz",
    });
  });

  it("tells anyone else ONLY that the slot is taken — no name, no count, no order", () => {
    // The client tier isn't mounted yet; enforcing it here means the day it is, it is a branch in
    // ONE place rather than a new endpoint that forgets the rule (§7).
    expect(
      projectDriverAvailability(
        { role: RolesEnum.Client },
        { conflicts, selfOverlap: true, gapMinutes: 60, driverName: "Ana Ruiz" },
      ),
    ).toEqual({ available: false });
  });

  it("is unavailable when the order's OWN events collide, even with a free driver", () => {
    const projected = projectDriverAvailability(
      { role: RolesEnum.Admin },
      { conflicts: [], selfOverlap: true, gapMinutes: 60 },
    );
    expect(projected).toMatchObject({ available: false, selfOverlap: true });
  });

  it("is available when nothing collides at all", () => {
    expect(
      projectDriverAvailability(
        { role: RolesEnum.Admin },
        { conflicts: [], selfOverlap: false, gapMinutes: 90 },
      ),
    ).toEqual({ available: true, gapMinutes: 90, selfOverlap: false, conflicts: [] });
  });
});

describe("the conflict errors", () => {
  it("carry their own names, so a controller can branch without string matching", () => {
    expect(new OrderSelfOverlapError(60).name).toBe("OrderSelfOverlapError");
    expect(
      new OrderDriverConflictError(
        { orderId: 9, at: at("2026-08-01T14:30:00Z"), kind: "DELIVERY", blocks: "DELIVERY" },
        60,
        decryptKms(encryptKms("Ana Ruiz")),
      ).name,
    ).toBe("OrderDriverConflictError");
  });
});
