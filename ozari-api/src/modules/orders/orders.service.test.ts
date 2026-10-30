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
  OrderSettlementConflictError,
  VARIANT_LABEL_SEPARATOR,
  assertSettlementSurvivesEdit,
  buildHoldingLinesWhere,
  buildOrderListWhere,
  conflictVariantFields,
  moveSaleStock,
  saleStockDeltas,
  poolQuantity,
  stockKey,
  variantLabelOf,
  buildRentedInWindowWhere,
  canRecordDepositCollection,
  canRecordSettlement,
  computeBilledDays,
  computeDepositTotal,
  computeNextActionAt,
  computeSettlementMoney,
  depositCollectionStatus,
  heldDeposit,
  isSettleableLine,
  lineImageUrl,
  richOrderInclude,
  pendingDepositToCollect,
  projectDepositCollection,
  withDepositToCollect,
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
  type PricedOrderLineModel,
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
  depositSettledAt: null,
  depositRetainedAmount: null,
  depositRetainedReason: null,
  depositReceivedAt: null,
  depositWaivedAt: null,
  depositWaivedReason: null,
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
    { quantity: 2, isRental: true, securityDeposit: null, replacementPrice: null },
    { quantity: 3, isRental: false, securityDeposit: null, replacementPrice: null },
  ],
  ...overrides,
});

/** A rich line with no deposit/damage, overridable — the settlement tests' building block. */
const makeRichLine = (
  overrides: Partial<RichOrder["serviceDetails"][number]> = {},
): RichOrder["serviceDetails"][number] => ({
  id: 11,
  productId: 3,
  quantity: 5,
  isRental: true,
  unitaryPrice: new Prisma.Decimal("30.00"),
  parcialPrice: new Prisma.Decimal("150.00"),
  securityDeposit: null,
  replacementPrice: null,
  damagedQuantity: 0,
  damageNote: null,
  variantId: null,
  variantLabel: null,
  product: { name: "Silla plegable", productImages: [] },
  variant: null,
  ...overrides,
});

/** A rich order row (the detail include) on top of the list defaults. */
const makeRichOrder = (overrides: Partial<RichOrder> = {}): RichOrder => ({
  ...makeListRow(),
  assignedUser: null,
  paymentMethod: null,
  serviceDetails: [makeRichLine()],
  serviceExtras: [],
  statusHistory: [],
  depositHistory: [],
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
    securityDeposit: null,
    replacementPrice: null,
    variants: [],
    ...overrides,
  });

  it("a Día rental bills unitary × qty × billed days", () => {
    expect(priceOrderLine(25, product(), 2)).toEqual({
      productId: 3,
      variantId: null,
      variantLabel: null,
      quantity: 25,
      isRental: true,
      unitaryPrice: 6,
      parcialPrice: 300,
      securityDeposit: null,
      replacementPrice: null,
    });
  });

  it("snapshots the per-unit deposit and replacement value on a RENTAL line only", () => {
    const guarded = product({
      securityDeposit: new Prisma.Decimal("40.00"),
      replacementPrice: new Prisma.Decimal("120.00"),
    });
    expect(priceOrderLine(2, guarded, 1)).toMatchObject({
      securityDeposit: 40,
      replacementPrice: 120,
    });
    // A product switched to Venta since keeps no guarantee on the line (a sale never comes back).
    expect(
      priceOrderLine(2, { ...guarded, productBusinessTypeId: 2, sellPrice: new Prisma.Decimal("9.00") }, 1),
    ).toMatchObject({ isRental: false, securityDeposit: null, replacementPrice: null });
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
    ).toEqual({
      productId: 3,
      variantId: null,
      variantLabel: null,
      quantity: 10,
      isRental: false,
      unitaryPrice: 3.5,
      parcialPrice: 35,
      securityDeposit: null,
      replacementPrice: null,
    });
  });

  it("rounds the final multiplication to cents", () => {
    expect(
      priceOrderLine(3, product({ rentPrice: new Prisma.Decimal("0.10") }), 1)?.parcialPrice,
    ).toBe(0.3);
  });

  it("returns null when the product violates the conditional price rule", () => {
    expect(priceOrderLine(1, product({ rentPrice: null }), 1)).toBeNull();
  });

  describe("a VARIANT line", () => {
    const value = (name: string, sortOrder: number) => ({
      optionValue: { name, option: { sortOrder } },
    });
    const guarded = product({
      securityDeposit: new Prisma.Decimal("40.00"),
      replacementPrice: new Prisma.Decimal("120.00"),
      variants: [
        {
          // Inherits everything; its values arrive out of option order.
          id: 31,
          rentPrice: null,
          sellPrice: null,
          securityDeposit: null,
          replacementPrice: null,
          values: [value("Redondo", 1), value("Rojo", 0)],
        },
        {
          // Overrides price + replacement, and asks NO deposit (0 = explicitly none).
          id: 32,
          rentPrice: new Prisma.Decimal("9.00"),
          sellPrice: null,
          securityDeposit: new Prisma.Decimal("0.00"),
          replacementPrice: new Prisma.Decimal("150.00"),
          values: [value("Azul", 0)],
        },
      ],
    });

    it("inherits the product's values and snapshots its label in OPTION order", () => {
      expect(priceOrderLine(2, guarded, 3, 31)).toEqual({
        productId: 3,
        variantId: 31,
        variantLabel: "Rojo · Redondo",
        quantity: 2,
        isRental: true,
        unitaryPrice: 6,
        parcialPrice: 36,
        securityDeposit: 40,
        replacementPrice: 120,
      });
    });

    it("prices from the variant's OVERRIDES — price, deposit (0 kept) and replacement", () => {
      expect(priceOrderLine(2, guarded, 1, 32)).toMatchObject({
        variantLabel: "Azul",
        unitaryPrice: 9,
        parcialPrice: 18,
        securityDeposit: 0,
        replacementPrice: 150,
      });
    });

    it("returns null for a variant that is not an ACTIVE variant of the product", () => {
      expect(priceOrderLine(1, guarded, 1, 99)).toBeNull();
    });

    it("a SALE variant bills its sell override", () => {
      const sale = product({
        productBusinessTypeId: 2,
        rentPrice: null,
        sellPrice: new Prisma.Decimal("3.00"),
        variants: [
          {
            id: 41,
            rentPrice: null,
            sellPrice: new Prisma.Decimal("4.50"),
            securityDeposit: null,
            replacementPrice: null,
            values: [value("Verde", 0)],
          },
        ],
      });
      expect(priceOrderLine(2, sale, 5, 41)).toMatchObject({
        isRental: false,
        unitaryPrice: 4.5,
        parcialPrice: 9,
        securityDeposit: null,
      });
    });
  });
});

describe("variation helpers", () => {
  it("stockKey identifies a pool: the product's own (no variant) or one variant", () => {
    expect(stockKey(3, null)).toBe("3:");
    expect(stockKey(3, undefined)).toBe("3:");
    expect(stockKey(3, 31)).toBe("3:31");
  });

  it("variantLabelOf joins the value names in OPTION order with the separator", () => {
    expect(VARIANT_LABEL_SEPARATOR).toBe(" · ");
    expect(
      variantLabelOf([
        { optionValue: { name: "Grande", option: { sortOrder: 2 } } },
        { optionValue: { name: "Rojo", option: { sortOrder: 0 } } },
        { optionValue: { name: "Redondo", option: { sortOrder: 1 } } },
      ]),
    ).toBe("Rojo · Redondo · Grande");
    expect(variantLabelOf([])).toBe("");
  });

  it("buildHoldingLinesWhere: open/future rentals by status, undelivered sales, never cancelled", () => {
    expect(buildHoldingLinesWhere({ out: [3, 4], window: [1, 2] })).toEqual({
      isActive: true,
      service: { isActive: true, cancelledAt: null },
      OR: [
        { isRental: true, service: { serviceStatusId: { in: [3, 4, 1, 2] } } },
        { isRental: false, service: { deliveredAt: null } },
      ],
    });
  });

  it("moveSaleStock writes the VARIANT row for a variant line, else the product row", async () => {
    const tx = {
      product: { update: vi.fn().mockResolvedValue({}) },
      productVariant: { update: vi.fn().mockResolvedValue({}) },
    } as unknown as Prisma.TransactionClient;
    await moveSaleStock(tx, { productId: 3, variantId: 31 }, -2);
    expect(tx.productVariant.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: { quantity: { increment: -2 } },
    });
    expect(tx.product.update).not.toHaveBeenCalled();
    await moveSaleStock(tx, { productId: 3, variantId: null }, 5);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { quantity: { increment: 5 } },
    });
  });

  it("saleStockDeltas nets an edit's SALE units per pool (rentals and unchanged pools drop out)", () => {
    const line = (productId: number, variantId: number | null, quantity: number, isRental = false) => ({
      productId,
      variantId,
      quantity,
      isRental,
    });
    expect(
      saleStockDeltas(
        [line(3, 31, 2), line(3, 32, 1), line(4, null, 5), line(9, null, 7, true)],
        [line(3, 31, 5), line(3, 33, 4), line(4, null, 5), line(9, null, 1, true)],
      ),
    ).toEqual([
      // Rojo grew by 3 → 3 more taken; Azul left → given back; Verde is new → taken.
      { productId: 3, variantId: 31, delta: -3 },
      { productId: 3, variantId: 32, delta: 1 },
      { productId: 3, variantId: 33, delta: -4 },
    ]);
  });

  it("conflictVariantFields carries the variant fields only for a variant line", () => {
    expect(conflictVariantFields(null, null)).toEqual({});
    expect(conflictVariantFields(31, "Rojo")).toEqual({ variantId: 31, variantLabel: "Rojo" });
  });

  it("poolQuantity reads the product's own stock, an ACTIVE variant's, or null when retired", () => {
    const product = { id: 3, quantity: 0, variants: [{ id: 31, quantity: 12 }] };
    expect(poolQuantity({ ...product, quantity: 7 }, null)).toBe(7);
    expect(poolQuantity(product, 31)).toBe(12);
    expect(poolQuantity(product, 99)).toBeNull();
  });
});

describe("lineImageUrl", () => {
  it("fetches ONE showcase image per line — the primary, else the first by display order", () => {
    // The pick lives in the query (never the whole gallery): primary first, then display order,
    // and never a value photo (the wrong colour for a line of another variant).
    expect(richOrderInclude.serviceDetails.select.product.select.productImages).toEqual({
      where: { optionValueId: null },
      orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
      take: 1,
      select: { url: true },
    });
  });

  it("is the fetched image's URL, or undefined when the product has none", () => {
    const url = "https://assets.example.com/products/chair.webp";
    expect(
      lineImageUrl({ product: { name: "Silla", productImages: [{ url }] }, variant: null }),
    ).toBe(url);
    expect(
      lineImageUrl({ product: { name: "Silla", productImages: [] }, variant: null }),
    ).toBeUndefined();
  });

  it("prefers the VARIANT's photo: its first value (option order) that has one", () => {
    const showcase = "https://assets.example.com/products/showcase.webp";
    const red = "https://assets.example.com/products/red.webp";
    const round = "https://assets.example.com/products/round.webp";
    const variant = {
      values: [
        { optionValue: { option: { sortOrder: 1 }, images: [{ url: round }] } },
        { optionValue: { option: { sortOrder: 0 }, images: [{ url: red }] } },
      ],
    };
    const product = { name: "Mantel", productImages: [{ url: showcase }] };
    expect(lineImageUrl({ product, variant })).toBe(red);
    // The first option's value has no photo → the next option's value gives it.
    expect(
      lineImageUrl({
        product,
        variant: {
          values: [
            { optionValue: { option: { sortOrder: 1 }, images: [{ url: round }] } },
            { optionValue: { option: { sortOrder: 0 }, images: [] } },
          ],
        },
      }),
    ).toBe(round);
    // No value has a photo → the showcase primary (never the default variant's).
    expect(
      lineImageUrl({
        product,
        variant: { values: [{ optionValue: { option: { sortOrder: 0 }, images: [] } }] },
      }),
    ).toBe(showcase);
  });

  it("the detail projection carries a variant line's id and label snapshot (absent without one)", () => {
    const detail = projectOrderDetail(
      makeRichOrder({
        serviceDetails: [
          makeRichLine({ id: 11, variantId: 31, variantLabel: "Rojo · Redondo" }),
          makeRichLine({ id: 12, productId: 4 }),
        ],
      }),
      makeProjectionContext(),
    );
    expect(detail.lines[0]).toMatchObject({ variantId: 31, variantLabel: "Rojo · Redondo" });
    expect(detail.lines[1]?.variantId).toBeUndefined();
    expect(detail.lines[1]?.variantLabel).toBeUndefined();
  });

  it("is what the detail projection carries per line", () => {
    const url = "https://assets.example.com/products/chair.webp";
    const detail = projectOrderDetail(
      makeRichOrder({
        serviceDetails: [makeRichLine({ product: { name: "Silla", productImages: [{ url }] } })],
      }),
      makeProjectionContext(),
    );
    expect(detail.lines[0]?.imageUrl).toBe(url);
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
      depositHistory: [],
    });
    expect(detail.assignee).toBeUndefined();
    expect(detail.isMine).toBe(false);
    // A product without photos projects no image — the document row prints without one.
    expect(detail.lines[0]?.imageUrl).toBeUndefined();
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

  it("maps the deposit trail: the money snapshot when recorded, absent on an undo", () => {
    const recordedAt = new Date("2026-08-03T09:00:00Z");
    const undoneAt = new Date("2026-08-04T09:00:00Z");
    const detail = projectOrderDetail(
      makeRichOrder({
        depositHistory: [
          {
            id: 1,
            kind: "RECORDED",
            depositTotal: new Prisma.Decimal("200.00"),
            claimsTotal: new Prisma.Decimal("290.00"),
            refundAmount: new Prisma.Decimal("0.00"),
            balanceDue: new Prisma.Decimal("90.00"),
            createdAt: recordedAt,
            byUser: { fullNameKms: encryptKms("Romeo Marroquín") },
          },
          {
            id: 2,
            kind: "UNDONE",
            depositTotal: null,
            claimsTotal: null,
            refundAmount: null,
            balanceDue: null,
            createdAt: undoneAt,
            byUser: { fullNameKms: encryptKms("Ana Pérez") },
          },
        ],
      }),
      makeProjectionContext(),
    );
    expect(detail.depositHistory).toEqual([
      {
        id: 1,
        kind: "RECORDED",
        depositTotal: 200,
        claimsTotal: 290,
        // A zero refund is a real recorded outcome, never "absent".
        refundAmount: 0,
        balanceDue: 90,
        byUserName: "Romeo Marroquín",
        at: recordedAt,
      },
      {
        id: 2,
        kind: "UNDONE",
        depositTotal: undefined,
        claimsTotal: undefined,
        refundAmount: undefined,
        balanceDue: undefined,
        byUserName: "Ana Pérez",
        at: undoneAt,
      },
    ]);
  });
});

describe("security deposit & damage settlement", () => {
  const dec = (value: string) => new Prisma.Decimal(value);
  const DELIVERED = new Date("2026-08-01T15:00:00Z");

  it("only a RENTAL line with a deposit or a replacement value is settleable", () => {
    const line = { isRental: true, quantity: 1, securityDeposit: null, replacementPrice: null };
    expect(isSettleableLine(line)).toBe(false);
    expect(isSettleableLine({ ...line, securityDeposit: dec("0") })).toBe(false);
    expect(isSettleableLine({ ...line, securityDeposit: dec("10") })).toBe(true);
    expect(isSettleableLine({ ...line, replacementPrice: dec("90") })).toBe(true);
    expect(isSettleableLine({ ...line, isRental: false, securityDeposit: dec("10") })).toBe(false);
  });

  it("totals the deposit over rental lines only (snapshot × quantity)", () => {
    expect(
      computeDepositTotal([
        { isRental: true, quantity: 3, securityDeposit: dec("12.50"), replacementPrice: null },
        { isRental: true, quantity: 2, securityDeposit: null, replacementPrice: dec("80") },
        { isRental: false, quantity: 9, securityDeposit: dec("99"), replacementPrice: null },
      ]),
    ).toBe(37.5);
  });

  it.each([
    // [deposit, retained, damages, refund, applied, balance]
    ["the happy path: everything goes back", 500, 0, 0, 500, 0, 0],
    ["partial damage: part is retained", 500, 150, 0, 350, 150, 0],
    ["a total loss beyond the deposit: the difference is owed", 500, 0, 1200, 0, 500, 700],
    ["retained + a replacement still inside the deposit", 500, 100, 300, 100, 400, 0],
    ["no deposit at all, only a replacement", 0, 0, 90, 0, 0, 90],
  ])("money: %s", (_label, deposit, retained, damages, refund, applied, balance) => {
    expect(computeSettlementMoney(deposit, retained, damages)).toEqual({
      claimsTotal: retained + damages,
      appliedFromDeposit: applied,
      refundAmount: refund,
      balanceDue: balance,
    });
  });

  it("flags the list item while a delivered, settleable order has no settlement", () => {
    const guarded = [
      { quantity: 2, isRental: true, securityDeposit: dec("50"), replacementPrice: null },
    ];
    const context = makeProjectionContext();
    expect(projectOrderListItem(makeListRow(), context).depositSettlementPending).toBe(false);
    expect(
      projectOrderListItem(makeListRow({ serviceDetails: guarded }), context).depositSettlementPending,
    ).toBe(false); // not delivered yet — nothing to judge
    expect(
      projectOrderListItem(makeListRow({ serviceDetails: guarded, deliveredAt: DELIVERED }), context)
        .depositSettlementPending,
    ).toBe(true);
    expect(
      projectOrderListItem(
        makeListRow({ serviceDetails: guarded, deliveredAt: DELIVERED, depositSettledAt: DELIVERED }),
        context,
      ).depositSettlementPending,
    ).toBe(false);
    expect(
      projectOrderListItem(
        makeListRow({ serviceDetails: guarded, deliveredAt: DELIVERED, cancelledAt: DELIVERED }),
        context,
      ).depositSettlementPending,
    ).toBe(false);
    expect(canRecordSettlement({ deliveredAt: DELIVERED, cancelledAt: null, depositSettledAt: null })).toBe(true);
  });

  it("projects no deposit block when no line can carry one, and the snapshots on every line", () => {
    const detail = projectOrderDetail(makeRichOrder(), makeProjectionContext());
    expect(detail.securityDeposit).toBeUndefined();
    expect(detail.lines[0]).toMatchObject({
      securityDeposit: undefined,
      replacementPrice: undefined,
      damagedQuantity: 0,
      damageNote: undefined,
    });
  });

  it("projects an unsettled deposit with whether it can be settled yet", () => {
    const order = makeRichOrder({
      serviceDetails: [makeRichLine({ securityDeposit: dec("40"), replacementPrice: dec("120") })],
    });
    expect(projectOrderDetail(order, makeProjectionContext()).securityDeposit).toEqual({
      total: 200,
      // Still PENDING — nothing is in hand yet.
      held: 0,
      collection: { status: "PENDING", at: undefined, reason: undefined, canRecord: true },
      canSettle: false,
      settlement: undefined,
    });
    expect(
      projectOrderDetail({ ...order, deliveredAt: DELIVERED }, makeProjectionContext()).securityDeposit
        ?.canSettle,
    ).toBe(true);
  });

  it("projects a settlement: retained + priced damages, applied from the deposit, the rest owed", () => {
    const detail = projectOrderDetail(
      makeRichOrder({
        deliveredAt: DELIVERED,
        depositReceivedAt: DELIVERED,
        depositSettledAt: DELIVERED,
        depositRetainedAmount: dec("60"),
        depositRetainedReason: "Manchas de vino",
        serviceDetails: [
          makeRichLine({
            securityDeposit: dec("40"),
            replacementPrice: dec("120"),
            damagedQuantity: 2,
            damageNote: "Patas rotas",
          }),
          makeRichLine({ id: 12, productId: 4, quantity: 1, replacementPrice: dec("75") }),
        ],
      }),
      makeProjectionContext(),
    );
    expect(detail.lines[0]).toMatchObject({ damagedQuantity: 2, damageNote: "Patas rotas" });
    expect(detail.securityDeposit).toEqual({
      total: 200,
      held: 200,
      // RECEIVED, and still recordable after the report (its money recomputes live).
      collection: { status: "RECEIVED", at: DELIVERED, reason: undefined, canRecord: true },
      canSettle: true,
      settlement: {
        settledAt: DELIVERED,
        retainedAmount: 60,
        retainedReason: "Manchas de vino",
        damages: [
          {
            lineId: 11,
            productName: "Silla plegable",
            quantity: 2,
            unitAmount: 120,
            amount: 240,
            note: "Patas rotas",
          },
        ],
        damagesTotal: 240,
        claimsTotal: 300,
        appliedFromDeposit: 200,
        refundAmount: 0,
        balanceDue: 100,
      },
    });
  });

  it("reads absent settlement columns as zero (a refund-in-full with no damage)", () => {
    const settlement = projectOrderDetail(
      makeRichOrder({
        deliveredAt: DELIVERED,
        depositReceivedAt: DELIVERED,
        depositSettledAt: DELIVERED,
        serviceDetails: [
          // A damaged line whose replacement value vanished reads as Q0 rather than NaN.
          makeRichLine({ securityDeposit: dec("40"), damagedQuantity: 1 }),
        ],
      }),
      makeProjectionContext(),
    ).securityDeposit?.settlement;
    expect(settlement).toMatchObject({
      retainedAmount: 0,
      retainedReason: undefined,
      damagesTotal: 0,
      refundAmount: 200,
      balanceDue: 0,
    });
    expect(settlement?.damages[0]?.note).toBeUndefined();
  });

  describe("assertSettlementSurvivesEdit", () => {
    const priced = (overrides: Partial<PricedOrderLineModel> = {}): PricedOrderLineModel => ({
      productId: 3,
      variantId: null,
      variantLabel: null,
      quantity: 5,
      isRental: true,
      unitaryPrice: 30,
      parcialPrice: 150,
      securityDeposit: 40,
      replacementPrice: 120,
      ...overrides,
    });
    const settled = (damagedQuantity: number, retained: string | null = null) => ({
      depositSettledAt: DELIVERED,
      depositRetainedAmount: retained === null ? null : dec(retained),
      serviceDetails: [{ productId: 3, variantId: null as number | null, damagedQuantity }],
    });

    it("passes an unsettled order, and a settled one the edit keeps coherent", () => {
      expect(() =>
        assertSettlementSurvivesEdit(
          { depositSettledAt: null, depositRetainedAmount: null, serviceDetails: [] },
          [],
        ),
      ).not.toThrow();
      expect(() => assertSettlementSurvivesEdit(settled(2, "0"), [priced()])).not.toThrow();
      // The ceiling is the NOMINAL deposit (5 × Q40 = Q200), whatever was collected — the order
      // carries no collection facts here at all.
      expect(() => assertSettlementSurvivesEdit(settled(2, "200"), [priced()])).not.toThrow();
      expect(() => assertSettlementSurvivesEdit(settled(0), [priced({ securityDeposit: null })])).not.toThrow();
    });

    it.each([
      ["the damaged line is dropped", settled(2), [] as PricedOrderLineModel[]],
      ["it is reduced below its damaged units", settled(2), [priced({ quantity: 1 })]],
      ["it lost its replacement value", settled(2), [priced({ replacementPrice: null })]],
      ["it became a sale", settled(2), [priced({ isRental: false })]],
      // 5 × Q40 = Q200 of deposit can no longer back the Q250 that was retained.
      ["the deposit shrank below what was retained", settled(0, "250"), [priced()]],
      ["the deposit was dropped while something was retained", settled(0, "0.01"), [priced({ securityDeposit: null })]],
    ])("refuses when %s", (_label, order, next) => {
      expect(() => assertSettlementSurvivesEdit(order, next)).toThrow(OrderSettlementConflictError);
    });

    it("matches a damaged line by (product, VARIANT) — another variant of the product is not it", () => {
      const order = {
        depositSettledAt: null,
        depositRetainedAmount: null,
        serviceDetails: [{ productId: 3, variantId: 31 as number | null, damagedQuantity: 2 }],
      };
      expect(() =>
        assertSettlementSurvivesEdit(order, [priced({ variantId: 31, variantLabel: "Rojo" })]),
      ).not.toThrow();
      // The edit swapped the damaged red chairs for blue ones: the damage has no line any more.
      expect(() =>
        assertSettlementSurvivesEdit(order, [priced({ variantId: 32, variantLabel: "Azul" })]),
      ).toThrow(OrderSettlementConflictError);
      expect(() => assertSettlementSurvivesEdit(order, [priced()])).toThrow(
        OrderSettlementConflictError,
      );
    });
  });
});

describe("deposit collection", () => {
  const dec = (value: string) => new Prisma.Decimal(value);
  const AT = new Date("2026-08-01T15:00:00Z");
  /** 5 chairs × Q40 = Q200 of deposit, Q120 replacement each. */
  const guardedLine = (overrides: Partial<RichOrder["serviceDetails"][number]> = {}) =>
    makeRichLine({ securityDeposit: dec("40"), replacementPrice: dec("120"), ...overrides });
  const stamps = { depositReceivedAt: null, depositWaivedAt: null };
  const deposit = [{ isRental: true, quantity: 5, securityDeposit: dec("40"), replacementPrice: null }];

  it("reads the status from whichever stamp is set", () => {
    expect(depositCollectionStatus(stamps)).toBe("PENDING");
    expect(depositCollectionStatus({ ...stamps, depositReceivedAt: AT })).toBe("RECEIVED");
    expect(depositCollectionStatus({ ...stamps, depositWaivedAt: AT })).toBe("WAIVED");
  });

  it("holds the nominal deposit only once RECEIVED — nothing while PENDING or WAIVED", () => {
    expect(heldDeposit({ depositReceivedAt: AT, serviceDetails: deposit })).toBe(200);
    // PENDING: no stamp at all — nothing is in hand yet.
    expect(heldDeposit({ depositReceivedAt: null, serviceDetails: deposit })).toBe(0);
    // WAIVED: only the waive stamp — still nothing in hand.
    expect(heldDeposit({ ...stamps, depositWaivedAt: AT, serviceDetails: deposit })).toBe(0);
    // A freshly priced line (plain numbers) reads through the same rule.
    expect(
      heldDeposit({
        depositReceivedAt: AT,
        serviceDetails: [{ isRental: true, quantity: 2, securityDeposit: 12.5, replacementPrice: null }],
      }),
    ).toBe(25);
  });

  it("may be recorded whenever the order is not cancelled — before or after the damage report", () => {
    expect(canRecordDepositCollection({ cancelledAt: null })).toBe(true);
    expect(canRecordDepositCollection({ cancelledAt: AT })).toBe(false);
    // A settled order is still recordable (owner 2026-10-28: a late deposit is recorded on the detail).
    const settledOrder = { cancelledAt: null, depositSettledAt: AT };
    expect(canRecordDepositCollection(settledOrder)).toBe(true);
  });

  it("asks about the deposit only when there is one, still pending, on a live unsettled order", () => {
    const order = { ...stamps, cancelledAt: null, depositSettledAt: null, serviceDetails: deposit };
    expect(pendingDepositToCollect(order)).toBe(200);
    expect(pendingDepositToCollect({ ...order, serviceDetails: [] })).toBeUndefined();
    expect(pendingDepositToCollect({ ...order, depositReceivedAt: AT })).toBeUndefined();
    expect(pendingDepositToCollect({ ...order, depositWaivedAt: AT })).toBeUndefined();
    expect(pendingDepositToCollect({ ...order, cancelledAt: AT })).toBeUndefined();
    // The delivery dialog stays a PRE-report question even though the collection itself is now
    // recordable after the report (that happens on the detail, not at the door).
    expect(pendingDepositToCollect({ ...order, depositSettledAt: AT })).toBeUndefined();
  });

  it("stamps depositToCollect on the forward DELIVERY move only", () => {
    const enRuta = { serviceStatusId: 5, serviceStatus: { id: 5, name: "En ruta" } };
    const withDeposit = makeListRow({ ...enRuta, serviceDetails: deposit });
    const actions = projectOrderListItem(withDeposit, makeProjectionContext()).actions;
    const forward = actions.find((action) => action.kind === "forward");
    expect(forward).toMatchObject({ statusId: 3, tracksEvent: "DELIVERY", depositToCollect: 200 });
    // Rewind and cancel never ask.
    for (const other of actions.filter((action) => action.kind !== "forward")) {
      expect(other.depositToCollect).toBeUndefined();
    }

    // A forward move that is NOT the delivery (Pendiente → En ruta) does not ask either…
    const pending = projectOrderListItem(makeListRow({ serviceDetails: deposit }), makeProjectionContext());
    expect(pending.actions.find((action) => action.kind === "forward")?.depositToCollect).toBeUndefined();
    // …nor does the delivery once the deposit was already received.
    const received = projectOrderListItem(
      makeListRow({ ...enRuta, serviceDetails: deposit, depositReceivedAt: AT }),
      makeProjectionContext(),
    );
    expect(received.actions.every((action) => action.depositToCollect === undefined)).toBe(true);
    // The pure helper passes actions through untouched when there is nothing to ask.
    expect(withDepositToCollect(actions, undefined)).toBe(actions);
  });

  it("projects the collection block: absent without a deposit, the stamp time, the waive reason", () => {
    const base = { ...stamps, depositWaivedReason: null, cancelledAt: null, depositSettledAt: null };
    expect(projectDepositCollection(base, 0)).toBeUndefined();
    expect(projectDepositCollection({ ...base, depositReceivedAt: AT }, 200)).toEqual({
      status: "RECEIVED",
      at: AT,
      reason: undefined,
      canRecord: true,
    });
    expect(
      projectDepositCollection(
        { ...base, depositWaivedAt: AT, depositWaivedReason: "Un familiar", cancelledAt: AT },
        200,
      ),
    ).toEqual({ status: "WAIVED", at: AT, reason: "Un familiar", canRecord: false });
    // A waived row whose reason is somehow missing still projects (no `null` leaks out).
    expect(projectDepositCollection({ ...base, depositWaivedAt: AT }, 200)?.reason).toBeUndefined();
  });

  it("replacement values alone carry no collection block", () => {
    const detail = projectOrderDetail(
      makeRichOrder({ serviceDetails: [makeRichLine({ replacementPrice: dec("90") })] }),
      makeProjectionContext(),
    );
    expect(detail.securityDeposit).toMatchObject({ total: 0, held: 0, collection: undefined });
  });

  it("a WAIVED deposit counts 0: nothing refunded, every replacement owed in full", () => {
    const detail = projectOrderDetail(
      makeRichOrder({
        deliveredAt: AT,
        depositWaivedAt: AT,
        depositWaivedReason: "Entregado a un familiar",
        depositSettledAt: AT,
        depositRetainedAmount: dec("0"),
        serviceDetails: [guardedLine({ damagedQuantity: 1 })],
      }),
      makeProjectionContext(),
    );
    expect(detail.securityDeposit).toMatchObject({
      total: 200,
      held: 0,
      // Still recordable after the report — a late deposit is recorded on the detail.
      collection: { status: "WAIVED", reason: "Entregado a un familiar", canRecord: true },
      settlement: {
        damagesTotal: 120,
        claimsTotal: 120,
        appliedFromDeposit: 0,
        refundAmount: 0,
        balanceDue: 120,
      },
    });
  });

  it("a PENDING deposit counts 0 too, and a late RECEIVED recomputes the same report live", () => {
    // Q50 retained + 1 chair at Q120 on a Q200 deposit that was never received.
    const report = {
      deliveredAt: AT,
      depositSettledAt: AT,
      depositRetainedAmount: dec("50"),
      depositRetainedReason: "Manchas",
      serviceDetails: [guardedLine({ damagedQuantity: 1 })],
    };
    const pending = projectOrderDetail(makeRichOrder(report), makeProjectionContext());
    expect(pending.securityDeposit).toMatchObject({
      total: 200,
      held: 0,
      collection: { status: "PENDING", canRecord: true },
      settlement: { claimsTotal: 170, appliedFromDeposit: 0, refundAmount: 0, balanceDue: 170 },
    });
    const received = projectOrderDetail(
      makeRichOrder({ ...report, depositReceivedAt: AT }),
      makeProjectionContext(),
    );
    expect(received.securityDeposit).toMatchObject({
      held: 200,
      collection: { status: "RECEIVED", canRecord: true },
      settlement: { claimsTotal: 170, appliedFromDeposit: 170, refundAmount: 30, balanceDue: 0 },
    });
  });

  it("maps the collection entries of the trail, with the waive note", () => {
    const detail = projectOrderDetail(
      makeRichOrder({
        depositHistory: [
          {
            id: 3,
            kind: "WAIVED",
            note: "Entregado a un familiar",
            depositTotal: dec("200.00"),
            claimsTotal: null,
            refundAmount: null,
            balanceDue: null,
            createdAt: AT,
            byUser: { fullNameKms: encryptKms("Romeo Marroquín") },
          },
        ],
      }),
      makeProjectionContext(),
    );
    expect(detail.depositHistory).toEqual([
      {
        id: 3,
        kind: "WAIVED",
        note: "Entregado a un familiar",
        depositTotal: 200,
        claimsTotal: undefined,
        refundAmount: undefined,
        balanceDue: undefined,
        byUserName: "Romeo Marroquín",
        at: AT,
      },
    ]);
  });
});
