import { beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { encryptKms } from "@helpers/encryption.js";
import { appConfig } from "@/config/app.js";
import {
  ORDER_LIST_VIEWS,
  buildOrderListWhere,
  buildRentedInWindowWhere,
  buildSpacingConflictWhere,
  computeBilledDays,
  orderListOrderBy,
  parseOrderListQuery,
  parseSpacingMinutes,
  priceOrderLine,
  projectOrderDetail,
  projectOrderListItem,
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
  serviceDetails: [{ quantity: 2 }, { quantity: 3 }],
  ...overrides,
});

/** A rich order row (the detail include) on top of the list defaults. */
const makeRichOrder = (overrides: Partial<RichOrder> = {}): RichOrder => ({
  ...makeListRow(),
  assignedUser: null,
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
    const item = projectOrderListItem(makeListRow());
    expect(item).toMatchObject({
      id: 7,
      clientName: "María López",
      isRegistryClient: false,
      eventType: { id: 1, name: "Evento familiar" },
      status: { id: 1, name: "Pendiente" },
      paymentStatus: { id: 1, name: "Pendiente" },
      deliveryAt: DELIVERY_AT,
      pickupAt: PICKUP_AT,
      itemCount: 5,
      totalAmount: 450,
      currency: { id: 1, iso4217Code: "GTQ", name: "Quetzal", symbol: "Q" },
    });
  });

  it("flags a walk-in registry client", () => {
    const item = projectOrderListItem(
      makeListRow({ userId: null, clientRegistryId: 9 }),
    );
    expect(item.isRegistryClient).toBe(true);
  });

  it("maps absent tracking timestamps (and a purchase-only pickup) to undefined", () => {
    const item = projectOrderListItem(makeListRow({ pickupAt: null }));
    expect(item.pickupAt).toBeUndefined();
    expect(item.deliveredAt).toBeUndefined();
    expect(item.collectedAt).toBeUndefined();
    expect(item.readyAt).toBeUndefined();
    expect(item.cancelledAt).toBeUndefined();
  });

  it("passes tracking timestamps through when set", () => {
    const readyAt = new Date("2026-08-02T13:00:00Z");
    const item = projectOrderListItem(makeListRow({ readyAt }));
    expect(item.readyAt).toBe(readyAt);
  });

  it("an order with no active lines counts zero items", () => {
    expect(projectOrderListItem(makeListRow({ serviceDetails: [] })).itemCount).toBe(0);
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
  it("holds rental lines of out/en-route orders unconditionally and pending ones by window overlap", () => {
    const start = new Date("2026-08-01T14:00:00Z");
    const end = new Date("2026-08-02T10:00:00Z");
    expect(buildRentedInWindowWhere([3, 4], start, end)).toEqual({
      productId: { in: [3, 4] },
      isActive: true,
      isRental: true,
      service: {
        isActive: true,
        cancelledAt: null,
        OR: [
          { serviceStatusId: 3 },
          { serviceStatusId: 5 },
          { serviceStatusId: 1, serviceStart: { lt: end }, serviceEnd: { gt: start } },
        ],
      },
    });
  });
});

describe("buildSpacingConflictWhere", () => {
  it("builds an exclusive ±spacing range over BOTH event columns for every new event", () => {
    const delivery = new Date("2026-08-01T14:00:00Z");
    const where = buildSpacingConflictWhere([delivery], 60);
    expect(where).toEqual({
      isActive: true,
      cancelledAt: null,
      OR: [
        { deliveryAt: { gt: new Date("2026-08-01T13:00:00Z"), lt: new Date("2026-08-01T15:00:00Z") } },
        { pickupAt: { gt: new Date("2026-08-01T13:00:00Z"), lt: new Date("2026-08-01T15:00:00Z") } },
      ],
    });
  });

  it("a delivery + pickup pair produces four range conditions", () => {
    const where = buildSpacingConflictWhere(
      [new Date("2026-08-01T14:00:00Z"), new Date("2026-08-02T10:00:00Z")],
      30,
    );
    expect((where.OR as unknown[]).length).toBe(4);
  });
});

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
    const detail = projectOrderDetail(makeRichOrder());
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
    expect(detail.assignedUser).toBeUndefined();
    expect(detail.deliveryAmount).toBeUndefined();
    expect(detail.description).toBeUndefined();
    expect(detail.comment).toBeUndefined();
    expect(detail.paidAt).toBeUndefined();
    expect(detail.cancelReason).toBeUndefined();
    expect(detail.discountReason).toBeUndefined();
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
      }),
    );
    expect(detail.assignedUser).toEqual({ id: 2, name: "Romeo Marroquín" });
    expect(detail.deliveryAmount).toBe(50);
    expect(detail.depositAmount).toBe(100);
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
