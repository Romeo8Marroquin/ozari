import { describe, it, expect, vi, beforeAll, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import {
  createOrder,
  getOrderAvailability,
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
  DEFAULT_EVIDENCE_BOUNDS,
  SEEDED_STATUS_CATALOG,
} from "@/tests/fixtures/lifecycleCatalog.js";
import { getStatusCatalog } from "./lifecycle/lifecycle.service.js";
import {
  type OrderAvailabilityResponseModel,
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
// The lifecycle machine: only its two DB readers are stubbed (with the SEEDED catalog + bounds) —
// every derivation, permission and projection below runs the real engine.
vi.mock("./lifecycle/lifecycle.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lifecycle/lifecycle.service.js")>()),
  getStatusCatalog: vi.fn(async () => SEEDED_STATUS_CATALOG),
  getEvidenceBounds: vi.fn(async () => DEFAULT_EVIDENCE_BOUNDS),
}));

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
  assignedUser: null,
  serviceDetails: [{ quantity: 25, isRental: true }],
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
  // The assignable-staff lookups: `findMany` for the catalog, `findFirst` for the create validator.
  const userFindMany = vi.fn().mockResolvedValue([]);
  const userFindFirst = vi.fn().mockResolvedValue({ id: 1 });
  (getPrismaClient as Mock).mockResolvedValue({
    service: { findMany, count, findFirst },
    eventType: { findMany: lookupFindMany },
    serviceStatus: { findMany: lookupFindMany },
    paymentStatus: { findMany: lookupFindMany },
    paymentMethod: { findMany: lookupFindMany },
    contactType: { findMany: lookupFindMany },
    zone: { findMany: lookupFindMany },
    user: { findMany: userFindMany, findFirst: userFindFirst },
    ...overrides,
  });
  return { findMany, count, findFirst, lookupFindMany, userFindMany, userFindFirst };
}

const buildReq = (
  query: Record<string, unknown> = {},
  params: Record<string, string> = {},
): CustomRequest =>
  ({ query, params, user: { userRole: 2, userId: 1 } }) as unknown as CustomRequest;

const successData = <T>(): T => (sendOzariSuccess as Mock).mock.calls[0]?.[3] as T;

beforeEach(() => vi.clearAllMocks());

describe("getOrders", () => {
  it("returns the projected page (agenda: fetch-all + in-memory sort/slice, count unused)", async () => {
    const { findMany, count } = mockPrisma();
    await getOrders(buildReq(), {} as Response);

    const data = successData<OrderListResponseModel>();
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0]).toMatchObject({
      id: 12,
      clientName: "María López",
      isRegistryClient: false,
      // The chip tone and the next step both come from the lifecycle machine.
      status: { id: 1, name: "Pendiente", colorKey: "amber" },
      nextStatus: { id: 5, name: "En ruta" },
      itemCount: 25,
      totalAmount: 450,
      isMine: false, // the admin (userId 1) isn't the assignee (unassigned)
    });
    // The admin may advance it and cancel it (no rewind — it sits at the first step).
    expect(data.orders[0]?.actions.map((action) => action.kind)).toEqual([
      "forward",
      "disruptive",
    ]);
    expect(data.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    // The agenda fetches every matching row (no orderBy/skip/take) and paginates in memory; the
    // total is the array length, so the DB `count` is never called.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, cancelledAt: null, readyAt: null } }),
    );
    const call = findMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call["orderBy"]).toBeUndefined();
    expect(call["skip"]).toBeUndefined();
    expect(call["take"]).toBeUndefined();
    expect(count).not.toHaveBeenCalled();
  });

  it("floats MINE (assigned to the admin) above the rest, ignoring raw delivery time", async () => {
    mockPrisma({
      service: {
        findMany: vi.fn().mockResolvedValue([
          { ...makeRawOrder(), id: 30, assignedUserId: null, deliveryAt: new Date("2026-08-01T06:00:00.000Z") },
          { ...makeRawOrder(), id: 31, assignedUserId: 1, deliveryAt: new Date("2026-08-01T20:00:00.000Z") },
        ]),
        count: vi.fn(),
      },
    });
    await getOrders(buildReq(), {} as Response); // admin userId 1

    const data = successData<OrderListResponseModel>();
    expect(data.orders.map((o) => o.id)).toEqual([31, 30]); // mine first, though it delivers later
    expect(data.orders[0]?.isMine).toBe(true);
    expect(data.orders[1]?.isMine).toBe(false);
  });

  it("a Driver is row-scoped to their assigned orders, next-action ordered", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { ...makeRawOrder(), id: 20, assignedUserId: 3, deliveryAt: new Date("2026-08-01T18:00:00.000Z") },
      { ...makeRawOrder(), id: 21, assignedUserId: 3, deliveryAt: new Date("2026-08-01T09:00:00.000Z") },
    ]);
    mockPrisma({ service: { findMany, count: vi.fn() } });
    await getOrders(
      { query: {}, params: {}, user: { userRole: 3, userId: 3 } } as unknown as CustomRequest,
      {} as Response,
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assignedUserId: 3 }) }),
    );
    const data = successData<OrderListResponseModel>();
    expect(data.orders.map((o) => o.id)).toEqual([21, 20]); // soonest next action first
    expect(data.orders.every((o) => o.isMine)).toBe(true);
  });

  it("paginates the in-memory agenda by page/pageSize", async () => {
    mockPrisma({
      service: {
        findMany: vi.fn().mockResolvedValue([
          { ...makeRawOrder(), id: 40, deliveryAt: new Date("2026-08-01T06:00:00.000Z") },
          { ...makeRawOrder(), id: 41, deliveryAt: new Date("2026-08-01T07:00:00.000Z") },
          { ...makeRawOrder(), id: 42, deliveryAt: new Date("2026-08-01T08:00:00.000Z") },
        ]),
        count: vi.fn(),
      },
    });
    await getOrders(buildReq({ page: "2", pageSize: "2" }), {} as Response);

    const data = successData<OrderListResponseModel>();
    expect(data.orders.map((o) => o.id)).toEqual([42]); // the 3rd row lands alone on page 2
    expect(data.pagination).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
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
    const body = { ...createBody(), paymentMethodId: 2 };
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
      paymentMethodId: 2,
      serviceStatusId: 1,
      paymentStatusId: 1,
      // No assignee in the body → defaults to the creating admin (userId 1), never unassigned.
      assignedUserId: 1,
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

  it("assigns the order to the CHOSEN staff member when the body carries one", async () => {
    const tx = mockCreateTx();
    // An explicit assignee (already validated as a deliverable user upstream) is used as-is.
    await createOrder(
      buildCreateReq({ ...createBody(), assignedUserId: 7 } as ReturnType<typeof createBody>),
      {} as Response,
    );
    const createArg = (tx.service.create as Mock).mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(createArg.data["assignedUserId"]).toBe(7);
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

  it("refuses with a 409 when the lifecycle has no initial step configured", async () => {
    const tx = mockCreateTx();
    (getStatusCatalog as Mock).mockResolvedValueOnce([]);
    await createOrder(buildCreateReq(createBody()), {} as Response);

    // Refusing beats inventing a status — nothing is written.
    expect(tx.service.create).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.createOrder.lifecycleUnconfigured",
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
  it("returns the reference lists + assignable staff (minLeadHours, zone fee, decrypted names)", async () => {
    const eventTypes = [{ id: 1, name: "Evento familiar", minLeadHours: 24 }];
    const statuses = [{ id: 1, name: "Pendiente" }];
    const methods = [{ id: 1, name: "Efectivo" }];
    // One zone with a configured fee (Decimal → number), one without (null → omitted). Returned by
    // the DB in id order; the controller re-sorts by ZONE NUMBER (Zona 1 before Zona 10).
    const zoneRows = [
      { id: 6, name: "Zona 10", deliveryFee: 50 },
      { id: 1, name: "Zona 1", deliveryFee: null },
    ];
    // The assignable staff (Admin + Driver) — encrypted names, decrypted + sorted alphabetically.
    const userRows = [
      { id: 2, fullNameKms: encryptKms("Romeo Marroquín"), role: { name: "Administrador" } },
      { id: 3, fullNameKms: encryptKms("Ana Díaz"), role: { name: "Repartidor" } },
    ];
    mockPrisma({
      eventType: { findMany: vi.fn().mockResolvedValue(eventTypes) },
      paymentStatus: { findMany: vi.fn().mockResolvedValue(statuses) },
      paymentMethod: { findMany: vi.fn().mockResolvedValue(methods) },
      contactType: { findMany: vi.fn().mockResolvedValue([{ id: 1, name: "WhatsApp" }]) },
      zone: { findMany: vi.fn().mockResolvedValue(zoneRows) },
      user: { findMany: vi.fn().mockResolvedValue(userRows) },
    });
    await getOrdersCatalog(buildReq(), {} as Response);

    const data = successData<OrderCatalogResponseModel>();
    // The statuses come from the lifecycle catalog, in PIPELINE order with the off-ramp last, each
    // carrying its declared behavior and RESOLVED evidence counts.
    expect(
      data.serviceStatuses.map((status) => [status.name, status.sortOrder]),
    ).toEqual([
      ["Pendiente", 1],
      ["En ruta", 2],
      ["Entregado", 3],
      ["Recolectado", 4],
      ["Listo", 5],
      ["Cancelado", undefined],
    ]);
    expect(data.serviceStatuses[2]).toEqual({
      id: 3,
      name: "Entregado",
      sortOrder: 3,
      isInitial: false,
      isDisruptive: false,
      inventoryHold: "OUT",
      requiresEvidence: true,
      minEvidence: 1,
      maxEvidence: 10,
      appliesTo: "ALL",
      tracksEvent: "DELIVERY",
      colorKey: "emerald",
    });
    expect(data).toEqual({
      eventTypes,
      serviceStatuses: data.serviceStatuses,
      paymentStatuses: statuses,
      paymentMethods: methods,
      contactTypes: [{ id: 1, name: "WhatsApp" }],
      zones: [
        { id: 1, name: "Zona 1" },
        { id: 6, name: "Zona 10", deliveryFee: 50 },
      ],
      // Alphabetical by decrypted name: Ana Díaz before Romeo Marroquín.
      assignableUsers: [
        { id: 3, name: "Ana Díaz", role: "Repartidor" },
        { id: 2, name: "Romeo Marroquín", role: "Administrador" },
      ],
    });
  });

  it("scopes every lookup to active rows in id order, and assignable staff to the deliverable roles", async () => {
    const { lookupFindMany, userFindMany } = mockPrisma();
    await getOrdersCatalog(buildReq(), {} as Response);

    // 5 seeded lookups (the statuses now come from the lifecycle catalog, not a raw lookup query);
    // each call carries the active-only filter and id order.
    expect(lookupFindMany).toHaveBeenCalledTimes(5);
    for (const call of lookupFindMany.mock.calls) {
      expect(call[0]).toMatchObject({ where: { isActive: true }, orderBy: { id: "asc" } });
    }
    // The assignable-staff query is scoped to active Admin(2)/Driver(3) users.
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, roleId: { in: [2, 3] } } }),
    );
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

describe("getOrderAvailability", () => {
  const availabilityReq = (body: Record<string, unknown>): CustomRequest =>
    ({ body, query: {}, params: {}, user: { userRole: 2, userId: 1 } }) as unknown as CustomRequest;
  const window = { deliveryAt: new Date("2026-08-01T14:00:00.000Z"), pickupAt: new Date("2026-08-02T10:00:00.000Z") };

  it("computes availability: sale = stock; rental = fleet minus what's held in the window", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { productId: 3, _sum: { quantity: 20 } }, // 30 - 20 = 10
      { productId: 6, _sum: { quantity: null } }, // null sum → 8 - 0 = 8
    ]);
    (getPrismaClient as Mock).mockResolvedValue({
      product: {
        findMany: vi.fn().mockResolvedValue([
          { id: 3, quantity: 30, productBusinessTypeId: 1 }, // rental, held
          { id: 5, quantity: 15, productBusinessTypeId: 1 }, // rental, none held → 15
          { id: 6, quantity: 8, productBusinessTypeId: 1 }, // rental, null-sum row → 8
          { id: 4, quantity: 120, productBusinessTypeId: 2 }, // sale → stock
        ]),
      },
      serviceDetail: { groupBy },
    });
    await getOrderAvailability(availabilityReq({ ...window, productIds: [3, 5, 6, 4] }), {} as Response);

    expect(groupBy).toHaveBeenCalled();
    expect(successData<OrderAvailabilityResponseModel>().availability).toEqual([
      { productId: 3, available: 10 },
      { productId: 5, available: 15 },
      { productId: 6, available: 8 },
      { productId: 4, available: 120 },
    ]);
  });

  it("returns null for rentals when there is NO pickup window (skips the groupBy query)", async () => {
    const groupBy = vi.fn();
    (getPrismaClient as Mock).mockResolvedValue({
      product: { findMany: vi.fn().mockResolvedValue([{ id: 3, quantity: 30, productBusinessTypeId: 1 }]) },
      serviceDetail: { groupBy },
    });
    await getOrderAvailability(availabilityReq({ deliveryAt: window.deliveryAt, pickupAt: undefined, productIds: [3] }), {} as Response);

    expect(groupBy).not.toHaveBeenCalled();
    expect(successData<OrderAvailabilityResponseModel>().availability).toEqual([{ productId: 3, available: null }]);
  });

  it("responds 500 when the query fails", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      product: { findMany: vi.fn().mockRejectedValue(new Error("db down")) },
    });
    await getOrderAvailability(availabilityReq({ ...window, productIds: [3] }), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.availability.error",
    );
  });
});
