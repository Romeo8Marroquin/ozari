import { describe, it, expect, vi, beforeAll, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import {
  createOrder,
  getOrderById,
  getOrders,
  getOrdersCatalog,
} from "./orders.controller.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { encryptKms } from "@helpers/encryption.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import {
  type OrderCatalogResponseModel,
  type OrderDetailEnvelopeModel,
  type OrderListResponseModel,
} from "./orders.models.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariSuccessModel.js", () => ({ sendOzariSuccess: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));
vi.mock("@/config/auditLogger.js", () => ({
  AuditAction: { ADMIN_ACTION: "ADMIN_ACTION" },
  logAudit: vi.fn(),
}));
vi.mock("@/config/environment.js", () => ({ isDeployedEnvironment: vi.fn(() => false) }));

const VALID_ENCRYPTION_KEY =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] = VALID_ENCRYPTION_KEY;
});

/** A raw order row as the LIST include fetches it (encrypted snapshots, Decimal money). */
const makeRawOrder = () => ({
  id: 12,
  userId: 4,
  clientRegistryId: null,
  deliveryNameKms: encryptKms("María López"),
  deliveryContactKms: encryptKms("WhatsApp 5555-1234"),
  deliveryAddressKms: encryptKms("Zona 10, 4a avenida 5-55"),
  description: null,
  eventTypeId: 1,
  deliveryAt: new Date("2026-08-01T14:00:00.000Z"),
  pickupAt: new Date("2026-08-02T10:00:00.000Z"),
  deliveredAt: null,
  collectedAt: null,
  readyAt: null,
  serviceStart: new Date("2026-08-01T14:00:00.000Z"),
  serviceEnd: new Date("2026-08-02T10:00:00.000Z"),
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
  createdAt: new Date("2026-07-16T12:00:00.000Z"),
  eventType: { id: 1, name: "Evento familiar" },
  serviceStatus: { id: 1, name: "Pendiente" },
  paymentStatus: { id: 1, name: "Pendiente" },
  currency: { id: 1, iso4217Code: "GTQ", name: "Quetzal Guatemalteco", symbol: "Q" },
  serviceDetails: [{ quantity: 25 }],
});

/** The same order as the RICH include fetches it (full lines, extras, history, driver). */
const makeRawRichOrder = () => ({
  ...makeRawOrder(),
  assignedUser: null,
  serviceDetails: [
    {
      id: 31,
      productId: 3,
      quantity: 25,
      isRental: true,
      unitaryPrice: new Prisma.Decimal("6.00"),
      parcialPrice: new Prisma.Decimal("150.00"),
      product: { name: "Silla plegable" },
    },
  ],
  serviceExtras: [],
  statusHistory: [
    {
      id: 1,
      createdAt: new Date("2026-07-16T12:00:00.000Z"),
      fromStatus: null,
      toStatus: { id: 1, name: "Pendiente" },
      byUser: { fullNameKms: encryptKms("Romeo Marroquín") },
    },
  ],
});

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const findMany = vi.fn().mockResolvedValue([makeRawOrder()]);
  const count = vi.fn().mockResolvedValue(1);
  const findFirst = vi.fn().mockResolvedValue(makeRawRichOrder());
  const lookupFindMany = vi.fn().mockResolvedValue([]);
  (getPrismaClient as Mock).mockResolvedValue({
    service: { findMany, count, findFirst },
    eventType: { findMany: lookupFindMany },
    serviceStatus: { findMany: lookupFindMany },
    paymentStatus: { findMany: lookupFindMany },
    contactType: { findMany: lookupFindMany },
    zone: { findMany: lookupFindMany },
    ...overrides,
  });
  return { findMany, count, findFirst, lookupFindMany };
}

const buildReq = (
  query: Record<string, unknown> = {},
  params: Record<string, string> = {},
): CustomRequest =>
  ({ query, params, user: { userRole: 2, userId: 1 } }) as unknown as CustomRequest;

const successData = <T>(): T => (sendOzariSuccess as Mock).mock.calls[0]?.[3] as T;

beforeEach(() => vi.clearAllMocks());

describe("getOrders", () => {
  it("returns the projected page with pagination (agenda defaults)", async () => {
    const { findMany } = mockPrisma();
    await getOrders(buildReq(), {} as Response);

    const data = successData<OrderListResponseModel>();
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0]).toMatchObject({
      id: 12,
      clientName: "María López",
      isRegistryClient: false,
      status: { id: 1, name: "Pendiente" },
      itemCount: 25,
      totalAmount: 450,
    });
    expect(data.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, cancelledAt: null, readyAt: null },
        orderBy: [{ deliveryAt: "asc" }, { id: "asc" }],
        skip: 0,
        take: 20,
      }),
    );
  });

  it("the history view flips the rows and the direction", async () => {
    const { findMany } = mockPrisma();
    await getOrders(buildReq({ view: "history", page: "2", pageSize: "10" }), {} as Response);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          OR: [{ cancelledAt: { not: null } }, { readyAt: { not: null } }],
        },
        orderBy: [{ deliveryAt: "desc" }, { id: "desc" }],
        skip: 10,
        take: 10,
      }),
    );
  });

  it("responds 500 when the query fails", async () => {
    mockPrisma({ service: { findMany: vi.fn().mockRejectedValue(new Error("db down")), count: vi.fn() } });
    await getOrders(buildReq(), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.getOrders.errorFetchingOrders",
    );
  });
});

describe("getOrderById", () => {
  it("returns the full projected detail (decrypted snapshots, lines, history)", async () => {
    const { findFirst } = mockPrisma();
    await getOrderById(buildReq({}, { id: "12" }), {} as Response);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 12, isActive: true } }),
    );
    const data = successData<OrderDetailEnvelopeModel>();
    expect(data.order).toMatchObject({
      id: 12,
      clientName: "María López",
      deliveryContact: "WhatsApp 5555-1234",
      deliveryAddress: "Zona 10, 4a avenida 5-55",
      lines: [{ id: 31, productName: "Silla plegable", isRental: true }],
      statusHistory: [
        { id: 1, from: undefined, to: { id: 1, name: "Pendiente" }, byUserName: "Romeo Marroquín" },
      ],
    });
  });

  it.each(["abc", "-1", "1.5"])("a malformed id (%s) is a plain 404 without a DB read", async (id) => {
    const { findFirst } = mockPrisma();
    await getOrderById(buildReq({}, { id }), {} as Response);

    expect(findFirst).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.getOrderById.orderNotFound",
    );
  });

  it("an unknown id is the same 404", async () => {
    mockPrisma({ service: { findFirst: vi.fn().mockResolvedValue(null) } });
    await getOrderById(buildReq({}, { id: "999" }), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.getOrderById.orderNotFound",
    );
  });

  it("responds 500 when the lookup fails", async () => {
    mockPrisma({ service: { findFirst: vi.fn().mockRejectedValue(new Error("db down")) } });
    await getOrderById(buildReq({}, { id: "12" }), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.getOrderById.errorFetchingOrder",
    );
  });
});

// ── createOrder ──────────────────────────────────────────────────────────────────────────────────

const txRentalProduct = {
  id: 3,
  name: "Silla plegable",
  quantity: 40,
  currencyId: 1,
  productBusinessTypeId: 1,
  rentTimeUnitId: 2,
  rentPrice: new Prisma.Decimal("6.00"),
  sellPrice: null,
};
const txSaleProduct = {
  id: 4,
  name: "Vasos desechables",
  quantity: 15,
  currencyId: 1,
  productBusinessTypeId: 2,
  rentTimeUnitId: null,
  rentPrice: null,
  sellPrice: new Prisma.Decimal("3.50"),
};

/** One rented-in-window grouped row, as `serviceDetail.groupBy` returns it. */
const rentedRow = (productId: number, rented: number) => ({
  productId,
  _sum: { quantity: rented },
});

type TxOverrides = {
  products?: unknown[];
  rented?: ReturnType<typeof rentedRow>[];
  spacingHit?: { id: number; deliveryAt: Date } | null;
};

function mockCreateTx(overrides: TxOverrides = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    product: {
      findMany: vi.fn().mockResolvedValue(overrides.products ?? [txRentalProduct, txSaleProduct]),
      update: vi.fn().mockResolvedValue({}),
    },
    serviceDetail: { groupBy: vi.fn().mockResolvedValue(overrides.rented ?? []) },
    appPreference: { findUnique: vi.fn().mockResolvedValue({ value: "60" }) },
    service: {
      findFirst: vi.fn().mockResolvedValue(overrides.spacingHit ?? null),
      create: vi.fn().mockResolvedValue({ id: 12 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(makeRawRichOrder()),
    },
  };
  (getPrismaClient as Mock).mockResolvedValue({
    $transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
  });
  return tx;
}

// 25h window → 2 billed days: rental 6 × 25 × 2 = 300; sale 3.50 × 10 = 35; +50 delivery = 385.
const createBody = () => ({
  clientRegistryId: 3,
  eventTypeId: 1,
  deliveryAt: new Date("2026-08-01T14:00:00.000Z"),
  pickupAt: new Date("2026-08-02T15:00:00.000Z"),
  deliveryName: "María López",
  deliveryContact: "WhatsApp 5555-1234",
  deliveryAddress: "Zona 10, 4a avenida 5-55",
  description: undefined,
  comment: undefined,
  deliveryAmount: 50,
  depositAmount: undefined,
  lines: [
    { productId: 3, quantity: 25 },
    { productId: 4, quantity: 10 },
  ],
});

const buildCreateReq = (body: ReturnType<typeof createBody>): CustomRequest =>
  ({ body, query: {}, params: {}, user: { userRole: 2, userId: 1 } }) as unknown as CustomRequest;

describe("createOrder", () => {
  it("creates a confirmed mixed order: server-side pricing, encrypted snapshots, sale decrement, audit row", async () => {
    const tx = mockCreateTx();
    const body = createBody();
    await createOrder(buildCreateReq(body), {} as Response);

    expect(tx.$queryRaw).toHaveBeenCalled();
    const createArg = (tx.service.create as Mock).mock.calls[0]?.[0] as {
      data: Record<string, unknown> & {
        serviceDetails: { create: Array<Record<string, unknown>> };
        statusHistory: { create: Record<string, unknown> };
      };
    };
    expect(createArg.data).toMatchObject({
      clientRegistryId: 3,
      eventTypeId: 1,
      totalAmount: 385,
      deliveryAmount: 50,
      serviceStatusId: 1,
      paymentStatusId: 1,
      deliveryAt: body.deliveryAt,
      pickupAt: body.pickupAt,
      serviceStart: body.deliveryAt,
      serviceEnd: body.pickupAt,
    });
    // PII snapshots are encrypted at rest — never the plaintext.
    expect(createArg.data["deliveryNameKms"]).toBeTruthy();
    expect(createArg.data["deliveryNameKms"]).not.toBe(body.deliveryName);
    expect(createArg.data.serviceDetails.create).toEqual([
      { productId: 3, quantity: 25, isRental: true, unitaryPrice: 6, parcialPrice: 300, currencyId: 1 },
      { productId: 4, quantity: 10, isRental: false, unitaryPrice: 3.5, parcialPrice: 35, currencyId: 1 },
    ]);
    expect(createArg.data.statusHistory.create).toEqual({ toStatusId: 1, byUserId: 1 });
    // Only the SALE line consumes stock permanently.
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { quantity: { decrement: 10 } },
    });
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CREATED,
      "orders.createOrder.orderCreated",
      expect.objectContaining({ order: expect.objectContaining({ id: 12 }) }),
    );
  });

  it("a purchase-only order never queries rental holds and bills a single day", async () => {
    const tx = mockCreateTx();
    const body = { ...createBody(), pickupAt: undefined, lines: [{ productId: 4, quantity: 10 }] };
    await createOrder(buildCreateReq(body as ReturnType<typeof createBody>), {} as Response);

    expect(tx.serviceDetail.groupBy).not.toHaveBeenCalled();
    const createArg = (tx.service.create as Mock).mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(createArg.data).toMatchObject({
      pickupAt: null,
      serviceEnd: body.deliveryAt,
      totalAmount: 85, // 35 + 50 delivery
    });
  });

  it("rolls back to a STRUCTURED 409 when the window lacks stock (rental) or shelves lack units (sale)", async () => {
    const tx = mockCreateTx({
      products: [txRentalProduct, { ...txSaleProduct, quantity: 5 }],
      rented: [rentedRow(3, 20)],
    });
    await createOrder(buildCreateReq(createBody()), {} as Response);

    expect(tx.service.create).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.createOrder.stockConflict",
      undefined,
      {
        conflicts: [
          { productId: 3, productName: "Silla plegable", requested: 25, available: 20 },
          { productId: 4, productName: "Vasos desechables", requested: 10, available: 5 },
        ],
      },
    );
  });

  it("rolls back to a 409 when another order's logistics event is too close", async () => {
    const tx = mockCreateTx({ spacingHit: { id: 9, deliveryAt: new Date("2026-08-01T14:30:00.000Z") } });
    await createOrder(buildCreateReq(createBody()), {} as Response);

    expect(tx.service.create).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.createOrder.spacingConflict",
    );
  });

  it("a product that vanished between validation and the lock is a conflict, not a 500", async () => {
    mockCreateTx({ products: [txRentalProduct] }); // the sale product is gone
    await createOrder(buildCreateReq(createBody()), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.createOrder.stockConflict",
      undefined,
      { conflicts: [{ productId: 4, productName: "#4", requested: 10, available: 0 }] },
    );
  });

  it("responds 500 when the transaction fails for any other reason", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await createOrder(buildCreateReq(createBody()), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.createOrder.errorCreatingOrder",
    );
  });
});

describe("getOrdersCatalog", () => {
  it("returns the five active reference lists (event types carry minLeadHours)", async () => {
    const eventTypes = [{ id: 1, name: "Evento familiar", minLeadHours: 24 }];
    const statuses = [{ id: 1, name: "Pendiente" }];
    mockPrisma({
      eventType: { findMany: vi.fn().mockResolvedValue(eventTypes) },
      serviceStatus: { findMany: vi.fn().mockResolvedValue(statuses) },
      paymentStatus: { findMany: vi.fn().mockResolvedValue(statuses) },
      contactType: { findMany: vi.fn().mockResolvedValue([{ id: 1, name: "WhatsApp" }]) },
      zone: { findMany: vi.fn().mockResolvedValue([{ id: 1, name: "Zona 1" }]) },
    });
    await getOrdersCatalog(buildReq(), {} as Response);

    const data = successData<OrderCatalogResponseModel>();
    expect(data).toEqual({
      eventTypes,
      serviceStatuses: statuses,
      paymentStatuses: statuses,
      contactTypes: [{ id: 1, name: "WhatsApp" }],
      zones: [{ id: 1, name: "Zona 1" }],
    });
  });

  it("scopes every lookup to active rows in id order", async () => {
    const { lookupFindMany } = mockPrisma();
    await getOrdersCatalog(buildReq(), {} as Response);

    // 5 lookups; each call carries the active-only filter and id order.
    expect(lookupFindMany).toHaveBeenCalledTimes(5);
    for (const call of lookupFindMany.mock.calls) {
      expect(call[0]).toMatchObject({ where: { isActive: true }, orderBy: { id: "asc" } });
    }
  });

  it("responds 500 when a lookup fails", async () => {
    mockPrisma({ eventType: { findMany: vi.fn().mockRejectedValue(new Error("db down")) } });
    await getOrdersCatalog(buildReq(), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.catalog.errorFetchingCatalog",
    );
  });
});
