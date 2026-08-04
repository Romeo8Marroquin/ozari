import { beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { encryptKms } from "@helpers/encryption.js";
import { appConfig } from "@/config/app.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  SEEDED_HOLDING_IDS,
  makeProjectionContext,
} from "@/tests/fixtures/lifecycleCatalog.js";
import {
  ORDER_LIST_VIEWS,
  buildOrderListWhere,
  buildRentedInWindowWhere,
  computeBilledDays,
  computeNextActionAt,
  orderListOrderBy,
  parseOrderListQuery,
  loadOrderTimingPreferences,
  parseSpacingMinutes,
  parseTurnaroundMinutes,
  priceOrderLine,
  projectOrderDetail,
  projectOrderListItem,
  sortAgendaRows,
  type OrderListRow,
  type OrderPricingProductModel,
  type RichOrder,
} from "./orders.service.js";

const VALID_ENCRYPTION_KEY =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] = VALID_ENCRYPTION_KEY;
});

const DELIVERY_AT = new Date("2026-08-01T14:00:00Z");
const PICKUP_AT = new Date("2026-08-02T10:00:00Z");

/** A list-shaped order row (the lean include) with sensible defaults, overridable per test. */
const makeListRow = (overrides: Partial<OrderListRow> = {}): OrderListRow => ({
  id: 7,
  userId: 4,
  clientRegistryId: null,
  deliveryNameKms: encryptKms("María López"),
  deliveryContactKms: encryptKms("WhatsApp 5555-1234"),
  deliveryAddressKms: encryptKms("Zona 10, 4a avenida 5-55"),
  description: null,
  eventTypeId: 1,
  deliveryAt: DELIVERY_AT,
  pickupAt: PICKUP_AT,
  deliveredAt: null,
  collectedAt: null,
  readyAt: null,
  serviceStart: DELIVERY_AT,
  serviceEnd: PICKUP_AT,
  assignedUserId: null,
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
  serviceDetails: [
    { quantity: 2, isRental: true },
    { quantity: 3, isRental: false },
  ],
  ...overrides,
});

/** A rich order row (the detail include) on top of the list defaults. */
const makeRichOrder = (overrides: Partial<RichOrder> = {}): RichOrder => ({
  ...makeListRow(),
  assignedUser: null,
  paymentMethod: null,
  serviceDetails: [
    {
      id: 11,
      productId: 3,
      quantity: 5,
      isRental: true,
      unitaryPrice: new Prisma.Decimal("30.00"),
      parcialPrice: new Prisma.Decimal("150.00"),
      product: { name: "Silla plegable" },
    },
  ],
  serviceExtras: [],
  statusHistory: [],
  evidences: [],
  ...overrides,
});

describe("parseOrderListQuery", () => {
  it("returns the defaults for an empty/absent query", () => {
    for (const query of [{}, undefined, null]) {
      expect(parseOrderListQuery(query)).toEqual({
        page: 1,
        pageSize: appConfig.defaultOrderPageSize,
        view: "agenda",
        statusId: undefined,
      });
    }
  });

  it("accepts every allowlisted view and clamps unknown ones to agenda", () => {
    for (const view of ORDER_LIST_VIEWS) {
      expect(parseOrderListQuery({ view }).view).toBe(view);
    }
    expect(parseOrderListQuery({ view: "everything" }).view).toBe("agenda");
    expect(parseOrderListQuery({ view: 3 }).view).toBe("agenda");
  });

  it("clamps pagination instead of rejecting it", () => {
    expect(parseOrderListQuery({ page: "0", pageSize: "9999" })).toMatchObject({
      page: 1,
      pageSize: appConfig.maxOrderPageSize,
    });
    expect(parseOrderListQuery({ page: "abc", pageSize: "x" })).toMatchObject({
      page: 1,
      pageSize: appConfig.defaultOrderPageSize,
    });
    expect(parseOrderListQuery({ page: "3", pageSize: "10" })).toMatchObject({
      page: 3,
      pageSize: 10,
    });
  });

  it("parses a positive statusId filter and drops anything else", () => {
    expect(parseOrderListQuery({ statusId: "5" }).statusId).toBe(5);
    expect(parseOrderListQuery({ statusId: "0" }).statusId).toBeUndefined();
    expect(parseOrderListQuery({ statusId: "-2" }).statusId).toBeUndefined();
    expect(parseOrderListQuery({ statusId: "abc" }).statusId).toBeUndefined();
  });
});

describe("buildOrderListWhere", () => {
  it("agenda = still-work rows: not cancelled, 'listo' not pressed", () => {
    expect(buildOrderListWhere(parseOrderListQuery({}))).toEqual({
      isActive: true,
      cancelledAt: null,
      readyAt: null,
    });
  });

  it("history = finished (readyAt set) OR cancelled rows", () => {
    expect(buildOrderListWhere(parseOrderListQuery({ view: "history" }))).toEqual({
      isActive: true,
      OR: [{ cancelledAt: { not: null } }, { readyAt: { not: null } }],
    });
  });

  it("adds the status filter only when present", () => {
    expect(
      buildOrderListWhere(parseOrderListQuery({ statusId: "3" })),
    ).toMatchObject({ serviceStatusId: 3 });
    expect(
      buildOrderListWhere(parseOrderListQuery({})),
    ).not.toHaveProperty("serviceStatusId");
  });

  it("scopes to an assignee when a scopeUserId is given (a Driver's own orders), else not", () => {
    // Driver scope → only their assigned orders.
    expect(buildOrderListWhere(parseOrderListQuery({}), 7)).toMatchObject({
      assignedUserId: 7,
    });
    // Admin (no scope) → every order, no assignee filter.
    expect(buildOrderListWhere(parseOrderListQuery({}))).not.toHaveProperty(
      "assignedUserId",
    );
  });
});

describe("computeNextActionAt", () => {
  // Derived from the tracked ACTUALS, never a status id — the statuses that stamp them are
  // admin-configurable, but "it has been delivered/collected" is a fact.
  const base = {
    id: 1,
    assignedUserId: null,
    deliveryAt: new Date("2026-08-01T14:00:00Z"),
    pickupAt: new Date("2026-08-03T10:00:00Z"),
    deliveredAt: null,
    collectedAt: null,
  };

  it("nothing tracked yet → its DELIVERY is the next action", () => {
    expect(computeNextActionAt(base)).toBe(base.deliveryAt);
  });

  it("delivered rental → its PICKUP; a purchase-only delivered falls back to the delivered moment", () => {
    const deliveredAt = new Date("2026-08-01T14:30:00Z");
    expect(computeNextActionAt({ ...base, deliveredAt })).toBe(base.pickupAt);
    expect(computeNextActionAt({ ...base, deliveredAt, pickupAt: null })).toBe(
      deliveredAt,
    );
  });

  it("collected order → its COLLECTION moment (it's waiting out the washing period)", () => {
    const collectedAt = new Date("2026-08-03T10:30:00Z");
    expect(
      computeNextActionAt({
        ...base,
        deliveredAt: new Date("2026-08-01T14:30:00Z"),
        collectedAt,
      }),
    ).toBe(collectedAt);
  });
});

describe("sortAgendaRows", () => {
  const row = (
    id: number,
    assignedUserId: number | null,
    deliveryAt: string,
    over: Partial<{ deliveredAt: string; pickupAt: string }> = {},
  ) => ({
    id,
    assignedUserId,
    deliveryAt: new Date(deliveryAt),
    pickupAt: over.pickupAt ? new Date(over.pickupAt) : null,
    deliveredAt: over.deliveredAt ? new Date(over.deliveredAt) : null,
    collectedAt: null,
  });

  it("floats MINE first, then orders by soonest next action, id breaking ties", () => {
    const me = row(1, 5, "2026-08-01T18:00:00Z"); // mine, later
    const mineSoon = row(2, 5, "2026-08-01T09:00:00Z"); // mine, sooner
    const other = row(3, 9, "2026-08-01T06:00:00Z"); // not mine, soonest overall
    const sorted = sortAgendaRows([me, other, mineSoon], 5);
    // Both mine come first (sooner then later), then the (earlier-in-time) other.
    expect(sorted.map((r) => r.id)).toEqual([2, 1, 3]);
  });

  it("a delivered rental sorts by its PICKUP, not its (earlier) delivery", () => {
    const deliveredEarly = row(1, 5, "2026-08-01T06:00:00Z", {
      deliveredAt: "2026-08-01T06:10:00Z",
      pickupAt: "2026-08-02T20:00:00Z", // next action far out
    });
    const pendingSoon = row(2, 5, "2026-08-02T08:00:00Z"); // delivers before the pickup above
    expect(sortAgendaRows([deliveredEarly, pendingSoon], 5).map((r) => r.id)).toEqual([2, 1]);
  });

  it("for a driver (every row theirs) it is a pure next-action ordering", () => {
    const a = row(1, 7, "2026-08-01T12:00:00Z");
    const b = row(2, 7, "2026-08-01T08:00:00Z");
    expect(sortAgendaRows([a, b], 7).map((r) => r.id)).toEqual([2, 1]);
  });

  it("breaks ties on id when two orders share the same next-action moment", () => {
    const a = row(5, 7, "2026-08-01T10:00:00Z");
    const b = row(3, 7, "2026-08-01T10:00:00Z");
    expect(sortAgendaRows([a, b], 7).map((r) => r.id)).toEqual([3, 5]);
  });
});

describe("orderListOrderBy", () => {
  it("agenda reads like a schedule (soonest first), history like a log (newest first)", () => {
    expect(orderListOrderBy("agenda")).toEqual([
      { deliveryAt: "asc" },
      { id: "asc" },
    ]);
    expect(orderListOrderBy("history")).toEqual([
      { deliveryAt: "desc" },
      { id: "desc" },
    ]);
  });
});

describe("projectOrderListItem", () => {
  it("decrypts the client-name snapshot and shapes the lookups + money", () => {
    const item = projectOrderListItem(makeListRow(), makeProjectionContext());
    expect(item).toMatchObject({
      id: 7,
      clientName: "María López",
      isRegistryClient: false,
      eventType: { id: 1, name: "Evento familiar" },
      // The chip tone rides along from the lifecycle catalog, not a client-side id map.
      status: { id: 1, name: "Pendiente", colorKey: "amber" },
      paymentStatus: { id: 1, name: "Pendiente" },
      deliveryAt: DELIVERY_AT,
      pickupAt: PICKUP_AT,
      itemCount: 5,
      totalAmount: 450,
      currency: { id: 1, iso4217Code: "GTQ", name: "Quetzal", symbol: "Q" },
    });
  });

  it("carries the mode-aware next step and the actor's permitted actions", () => {
    // A rental order in Pendiente: next is En ruta; the admin may advance, and cancel.
    const mine = projectOrderListItem(makeListRow(), makeProjectionContext());
    expect(mine.nextStatus).toEqual({ id: 5, name: "En ruta" });
    expect(mine.actions.map((action) => action.kind)).toEqual([
      "forward",
      "disruptive",
    ]);

    // A DRIVER sees nothing on an order that isn't assigned to them.
    const foreign = projectOrderListItem(
      makeListRow(),
      makeProjectionContext({ userId: 7, role: RolesEnum.Driver }),
    );
    expect(foreign.nextStatus).toEqual({ id: 5, name: "En ruta" });
    expect(foreign.actions).toEqual([]);
  });

  it("a purchase-only order in the delivered step is finished — no next step", () => {
    const item = projectOrderListItem(
      makeListRow({
        serviceStatusId: 3,
        serviceStatus: { id: 3, name: "Entregado" },
        pickupAt: null,
        serviceDetails: [{ quantity: 4, isRental: false }],
      }),
      makeProjectionContext(),
    );
    expect(item.nextStatus).toBeUndefined();
    expect(item.actions.map((action) => action.kind)).toEqual([
      "backward",
      "disruptive",
    ]);
  });

  it("leaves the tone absent when the status is unknown to the catalog", () => {
    const item = projectOrderListItem(
      makeListRow({
        serviceStatusId: 99,
        serviceStatus: { id: 99, name: "Inventado" },
      }),
      makeProjectionContext(),
    );
    expect(item.status.colorKey).toBeUndefined();
    expect(item.nextStatus).toBeUndefined();
  });

  it("flags a walk-in registry client", () => {
    const item = projectOrderListItem(
      makeListRow({ userId: null, clientRegistryId: 9 }),
      makeProjectionContext(),
    );
    expect(item.isRegistryClient).toBe(true);
  });

  it("maps absent tracking timestamps (and a purchase-only pickup) to undefined", () => {
    const item = projectOrderListItem(
      makeListRow({ pickupAt: null }),
      makeProjectionContext(),
    );
    expect(item.pickupAt).toBeUndefined();
    expect(item.deliveredAt).toBeUndefined();
    expect(item.collectedAt).toBeUndefined();
    expect(item.readyAt).toBeUndefined();
    expect(item.cancelledAt).toBeUndefined();
  });

  it("passes tracking timestamps through when set", () => {
    const readyAt = new Date("2026-08-02T13:00:00Z");
    const item = projectOrderListItem(
      makeListRow({ readyAt }),
      makeProjectionContext(),
    );
    expect(item.readyAt).toBe(readyAt);
  });

  it("an order with no active lines counts zero items", () => {
    expect(
      projectOrderListItem(
        makeListRow({ serviceDetails: [] }),
        makeProjectionContext(),
      ).itemCount,
    ).toBe(0);
  });

  it("a cancelled order offers nothing at all", () => {
    const item = projectOrderListItem(
      makeListRow({
        serviceStatusId: 2,
        serviceStatus: { id: 2, name: "Cancelado" },
        cancelledAt: new Date("2026-07-20T10:00:00Z"),
      }),
      makeProjectionContext(),
    );
    expect(item.nextStatus).toBeUndefined();
    expect(item.actions).toEqual([]);
  });

  it("projects the assignee + isMine relative to the requesting user", () => {
    const assignedRow = makeListRow({
      assignedUserId: 2,
      assignedUser: { id: 2, fullNameKms: encryptKms("Romeo Marroquín") },
    });
    // The viewer IS the assignee → mine, with the decrypted name.
    const mine = projectOrderListItem(
      assignedRow,
      makeProjectionContext({ userId: 2 }),
    );
    expect(mine.assignee).toEqual({ id: 2, name: "Romeo Marroquín" });
    expect(mine.isMine).toBe(true);
    // Another viewer → the same assignee, but not theirs.
    expect(
      projectOrderListItem(assignedRow, makeProjectionContext({ userId: 9 }))
        .isMine,
    ).toBe(false);
    // Unassigned → no assignee, never anyone's.
    const unassigned = projectOrderListItem(
      makeListRow(),
      makeProjectionContext({ userId: 2 }),
    );
    expect(unassigned.assignee).toBeUndefined();
    expect(unassigned.isMine).toBe(false);
  });
});

describe("computeBilledDays", () => {
  it("bills one day for anything up to and INCLUDING exactly 24h", () => {
    const start = new Date("2026-08-01T14:00:00Z");
    expect(computeBilledDays(start, new Date("2026-08-01T16:00:00Z"))).toBe(1);
    expect(computeBilledDays(start, new Date("2026-08-02T14:00:00Z"))).toBe(1);
  });

  it("a STARTED 24h block bills the next day (the pickup minute decides)", () => {
    const start = new Date("2026-08-01T14:00:00Z");
    expect(computeBilledDays(start, new Date("2026-08-02T14:01:00Z"))).toBe(2);
    expect(computeBilledDays(start, new Date("2026-08-04T14:00:00Z"))).toBe(3);
  });
});

describe("parseSpacingMinutes", () => {
  it("parses a positive integer preference", () => {
    expect(parseSpacingMinutes("90")).toBe(90);
  });

  it("falls back to the default on missing/corrupt/non-positive values", () => {
    for (const value of [undefined, "0", "-5", "1.5", "abc", ""]) {
      expect(parseSpacingMinutes(value)).toBe(appConfig.defaultLogisticsSpacingMinutes);
    }
  });
});

describe("buildRentedInWindowWhere", () => {
  const start = new Date("2026-08-01T14:00:00Z");
  const end = new Date("2026-08-02T10:00:00Z");

  it("holds OUT statuses unconditionally and WINDOW ones only by overlap, from the flags", () => {
    expect(
      buildRentedInWindowWhere([3, 4], start, end, SEEDED_HOLDING_IDS, {
        turnaroundMinutes: 0,
      }),
    ).toEqual({
      productId: { in: [3, 4] },
      isActive: true,
      isRental: true,
      service: {
        isActive: true,
        cancelledAt: null,
        OR: [
          // En ruta + Entregado + Recolectado (units on the truck, out, or being washed).
          { serviceStatusId: { in: [3, 4, 5] } },
          {
            serviceStatusId: { in: [1] },
            serviceStart: { lt: end },
            serviceEnd: { gt: start },
          },
        ],
      },
    });
  });

  it("keeps units held for the WASHING period past the billed window", () => {
    // Goods come back dirty: an event ending at 10:00 does not free its chairs at 10:00. Without
    // this, two future orders two hours apart both passed — the check said yes and the business
    // couldn't deliver.
    const where = buildRentedInWindowWhere([3], start, end, SEEDED_HOLDING_IDS, {
      turnaroundMinutes: 120,
    });
    const windowBranch = (where.service as { OR: Array<Record<string, unknown>> }).OR[1];
    // Expressed as "held rows whose end is after (start − turnaround)" — the same comparison as
    // `heldEnd + turnaround > start`, but a plain column compare the index can serve.
    expect(windowBranch).toMatchObject({
      serviceEnd: { gt: new Date("2026-08-01T12:00:00Z") },
    });
  });

  it("an unconfigured machine (no holding statuses) simply matches nothing", () => {
    const where = buildRentedInWindowWhere(
      [3],
      new Date(),
      new Date(),
      { out: [], window: [] },
      { turnaroundMinutes: 0 },
    );
    expect(where.service).toMatchObject({
      OR: [
        { serviceStatusId: { in: [] } },
        expect.objectContaining({ serviceStatusId: { in: [] } }),
      ],
    });
  });
});

describe("parseTurnaroundMinutes", () => {
  it("accepts ZERO — a business with no cleaning step is a real configuration", () => {
    expect(parseTurnaroundMinutes("0")).toBe(0);
    expect(parseTurnaroundMinutes("180")).toBe(180);
  });

  it("falls back to the seeded default on a missing or corrupt value", () => {
    expect(parseTurnaroundMinutes(undefined)).toBe(appConfig.defaultTurnaroundMinutes);
    expect(parseTurnaroundMinutes("abc")).toBe(appConfig.defaultTurnaroundMinutes);
    expect(parseTurnaroundMinutes("-5")).toBe(appConfig.defaultTurnaroundMinutes);
  });
});

describe("loadOrderTimingPreferences", () => {
  const client = (rows: Array<{ key: string; value: string }>) => ({
    appPreference: { findMany: vi.fn().mockResolvedValue(rows) },
  });

  it("reads BOTH clock rules in one query", async () => {
    const prisma = client([
      { key: "orders.logisticsSpacingMinutes", value: "90" },
      { key: "orders.turnaroundMinutes", value: "45" },
    ]);
    await expect(loadOrderTimingPreferences(prisma)).resolves.toEqual({
      spacingMinutes: 90,
      turnaroundMinutes: 45,
    });
    expect(prisma.appPreference.findMany).toHaveBeenCalledTimes(1);
  });

  it("falls back per-rule when a preference row is missing", async () => {
    await expect(loadOrderTimingPreferences(client([]))).resolves.toEqual({
      spacingMinutes: appConfig.defaultLogisticsSpacingMinutes,
      turnaroundMinutes: appConfig.defaultTurnaroundMinutes,
    });
  });
});

// The logistics-event conflict rule moved to `logistics/` when it stopped being a global "N minutes
// between anything" filter and became a per-DRIVER one — its tests live in `logistics.service.test.ts`.

describe("priceOrderLine", () => {
  const product = (overrides: Partial<OrderPricingProductModel> = {}): OrderPricingProductModel => ({
    id: 3,
    name: "Silla plegable",
    productBusinessTypeId: 1, // Alquiler
    rentTimeUnitId: 2, // Día
    rentPrice: new Prisma.Decimal("6.00"),
    sellPrice: null,
    ...overrides,
  });

  it("a Día rental bills unitary × qty × billed days", () => {
    expect(priceOrderLine(25, product(), 2)).toEqual({
      productId: 3,
      quantity: 25,
      isRental: true,
      unitaryPrice: 6,
      parcialPrice: 300,
    });
  });

  it("an Evento rental bills flat, duration-agnostic", () => {
    expect(priceOrderLine(2, product({ rentTimeUnitId: 5, rentPrice: new Prisma.Decimal("150.00") }), 3)).toMatchObject({
      isRental: true,
      parcialPrice: 300,
    });
  });

  it("a sale bills sellPrice × qty once, ignoring the days", () => {
    expect(
      priceOrderLine(
        10,
        product({ productBusinessTypeId: 2, rentPrice: null, sellPrice: new Prisma.Decimal("3.50") }),
        4,
      ),
    ).toEqual({ productId: 3, quantity: 10, isRental: false, unitaryPrice: 3.5, parcialPrice: 35 });
  });

  it("rounds the final multiplication to cents", () => {
    expect(
      priceOrderLine(3, product({ rentPrice: new Prisma.Decimal("0.10") }), 1)?.parcialPrice,
    ).toBe(0.3);
  });

  it("returns null when the product violates the conditional price rule", () => {
    expect(priceOrderLine(1, product({ rentPrice: null }), 1)).toBeNull();
  });
});

describe("projectOrderDetail", () => {
  it("extends the list item with decrypted snapshots, lines, and the billed period", () => {
    const detail = projectOrderDetail(makeRichOrder(), makeProjectionContext());
    expect(detail).toMatchObject({
      clientName: "María López",
      deliveryContact: "WhatsApp 5555-1234",
      deliveryAddress: "Zona 10, 4a avenida 5-55",
      serviceStart: DELIVERY_AT,
      serviceEnd: PICKUP_AT,
      itemCount: 5,
      lines: [
        {
          id: 11,
          productId: 3,
          productName: "Silla plegable",
          isRental: true,
          quantity: 5,
          unitaryPrice: 30,
          parcialPrice: 150,
        },
      ],
      extras: [],
      statusHistory: [],
    });
    expect(detail.assignee).toBeUndefined();
    expect(detail.isMine).toBe(false);
    // No pin is the NORMAL case — the maps button falls back to searching the address text.
    expect(detail.deliveryCoords).toBeUndefined();
    expect(detail.deliveryAmount).toBeUndefined();
    expect(detail.description).toBeUndefined();
    expect(detail.comment).toBeUndefined();
    expect(detail.paidAt).toBeUndefined();
    expect(detail.cancelReason).toBeUndefined();
    expect(detail.discountReason).toBeUndefined();
  });

  it("decrypts the delivery PIN when the order has one, and ignores an unreadable value", () => {
    const pinned = projectOrderDetail(
      makeRichOrder({ deliveryCoordsKms: encryptKms("14.634915,-90.506883") }),
      makeProjectionContext(),
    );
    expect(pinned.deliveryCoords).toEqual({ lat: 14.634915, lng: -90.506883 });

    // …and the arrival instructions beside it — the one delivery field the DRIVER reads.
    const guided = projectOrderDetail(
      makeRichOrder({ deliveryInstructionsKms: encryptKms("Portón negro") }),
      makeProjectionContext(),
    );
    expect(guided.deliveryInstructions).toBe("Portón negro");
    expect(pinned.deliveryInstructions).toBeUndefined();

    // A hand-edited or legacy value must read as "no pin" — a NaN would render nowhere on a map and
    // deep-link a driver into the ocean, which is strictly worse than having no pin at all.
    const corrupt = projectOrderDetail(
      makeRichOrder({ deliveryCoordsKms: encryptKms("por la iglesia") }),
      makeProjectionContext(),
    );
    expect(corrupt.deliveryCoords).toBeUndefined();
  });

  it("decrypts the assigned driver's name and maps the money breakdown", () => {
    const paidAt = new Date("2026-07-20T10:00:00Z");
    const detail = projectOrderDetail(
      makeRichOrder({
        assignedUserId: 2,
        assignedUser: { id: 2, fullNameKms: encryptKms("Romeo Marroquín") },
        deliveryAmount: new Prisma.Decimal("50.00"),
        depositAmount: new Prisma.Decimal("100.00"),
        discountAmount: new Prisma.Decimal("25.00"),
        discountReason: "Cliente recurrente",
        paidAt,
        description: "Cumpleaños en el jardín",
        comment: "Llamar al llegar",
        paymentMethod: { id: 1, name: "Efectivo" },
      }),
      makeProjectionContext({ userId: 2 }),
    );
    expect(detail.assignee).toEqual({ id: 2, name: "Romeo Marroquín" });
    expect(detail.isMine).toBe(true);
    expect(detail.deliveryAmount).toBe(50);
    expect(detail.depositAmount).toBe(100);
    expect(detail.paymentMethod).toEqual({ id: 1, name: "Efectivo" });
    expect(detail.discountAmount).toBe(25);
    expect(detail.discountReason).toBe("Cliente recurrente");
    expect(detail.paidAt).toBe(paidAt);
    expect(detail.description).toBe("Cumpleaños en el jardín");
    expect(detail.comment).toBe("Llamar al llegar");
  });

  it("maps extras with every nullable field absent and present", () => {
    const detail = projectOrderDetail(
      makeRichOrder({
        serviceExtras: [
          {
            id: 1,
            name: "Instalación",
            description: null,
            quantity: null,
            unitaryPrice: null,
            parcialPrice: null,
          },
          {
            id: 2,
            name: "Mantel extra",
            description: "Blanco",
            quantity: 2,
            unitaryPrice: new Prisma.Decimal("10.00"),
            parcialPrice: new Prisma.Decimal("20.00"),
          },
        ],
      }),
      makeProjectionContext(),
    );
    expect(detail.extras).toEqual([
      {
        id: 1,
        name: "Instalación",
        description: undefined,
        quantity: undefined,
        unitaryPrice: undefined,
        parcialPrice: undefined,
      },
      {
        id: 2,
        name: "Mantel extra",
        description: "Blanco",
        quantity: 2,
        unitaryPrice: 10,
        parcialPrice: 20,
      },
    ]);
  });

  it("maps the status audit trail, with `from` absent on the creation row", () => {
    const at = new Date("2026-07-16T12:00:00Z");
    const detail = projectOrderDetail(
      makeRichOrder({
        statusHistory: [
          {
            id: 1,
            createdAt: at,
            fromStatus: null,
            toStatus: { id: 1, name: "Pendiente" },
            byUser: { fullNameKms: encryptKms("Romeo Marroquín") },
          },
          {
            id: 2,
            createdAt: at,
            fromStatus: { id: 1, name: "Pendiente" },
            toStatus: { id: 5, name: "En ruta" },
            byUser: { fullNameKms: encryptKms("Romeo Marroquín") },
          },
        ],
      }),
      makeProjectionContext(),
    );
    expect(detail.statusHistory).toEqual([
      {
        id: 1,
        from: undefined,
        to: { id: 1, name: "Pendiente" },
        byUserName: "Romeo Marroquín",
        at,
      },
      {
        id: 2,
        from: { id: 1, name: "Pendiente" },
        to: { id: 5, name: "En ruta" },
        byUserName: "Romeo Marroquín",
        at,
      },
    ]);
  });
});
