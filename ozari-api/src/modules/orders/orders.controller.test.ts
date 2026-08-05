import { describe, it, expect, vi, beforeAll, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import {
  createOrder,
  deleteOrder,
  getOrderAvailability,
  getOrderById,
  getOrders,
  getOrdersCatalog,
  updateOrder,
} from "./orders.controller.js";
import { getStorage } from "@helpers/storage.js";
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
vi.mock("@helpers/storage.js", () => ({ getStorage: vi.fn() }));
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
  evidences: [
    {
      id: 9,
      serviceStatusId: 3,
      url: "https://cdn.example.com/orders/evidence/a.webp",
      createdAt: new Date("2026-08-01T15:00:00.000Z"),
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
      // The tracking photos ride along, each tagged with the step it documents.
      evidence: [
        { id: 9, statusId: 3, url: "https://cdn.example.com/orders/evidence/a.webp" },
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

  it("row-scopes a DRIVER to their own orders — another worker's is a plain 404", async () => {
    const { findFirst } = mockPrisma();
    await getOrderById(
      { query: {}, params: { id: "12" }, user: { userRole: 3, userId: 7 } } as unknown as CustomRequest,
      {} as Response,
    );
    // The scoping is in the QUERY: an order that isn't theirs simply isn't found, so the answer
    // never confirms that it exists.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 12, isActive: true, assignedUserId: 7 } }),
    );

    // …while an Admin's query carries no assignee filter at all.
    vi.clearAllMocks();
    const admin = mockPrisma();
    await getOrderById(buildReq({}, { id: "12" }), {} as Response);
    expect(admin.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 12, isActive: true } }),
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

/** The seeded timing rules as `loadOrderTimingPreferences` reads them. */
const TIMING_PREFERENCES = [
  { key: "orders.logisticsSpacingMinutes", value: "60" },
  { key: "orders.turnaroundMinutes", value: "120" },
];

/** One rented-in-window grouped row, as `serviceDetail.groupBy` returns it. */
const rentedRow = (productId: number, rented: number) => ({
  productId,
  _sum: { quantity: rented },
});

/** One order already on the driver's day, as the logistics candidate query selects it. The actuals
 *  default to unstamped — the events are still to be performed, so they still occupy the day. */
const driverEvent = (
  id: number,
  deliveryAt: string,
  pickupAt: string | null = null,
  performed: { deliveredAt?: string; collectedAt?: string } = {},
) => ({
  id,
  deliveryAt: new Date(deliveryAt),
  pickupAt: pickupAt === null ? null : new Date(pickupAt),
  deliveredAt: performed.deliveredAt ? new Date(performed.deliveredAt) : null,
  collectedAt: performed.collectedAt ? new Date(performed.collectedAt) : null,
  assignedUser: { fullNameKms: encryptKms("Ana Ruiz") },
});

type TxOverrides = {
  products?: unknown[];
  rented?: ReturnType<typeof rentedRow>[];
  /** What the driver-conflict query finds — the widened candidate set, refined in code. */
  driverCandidates?: ReturnType<typeof driverEvent>[];
};

function mockCreateTx(overrides: TxOverrides = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    product: {
      findMany: vi.fn().mockResolvedValue(overrides.products ?? [txRentalProduct, txSaleProduct]),
      update: vi.fn().mockResolvedValue({}),
    },
    serviceDetail: { groupBy: vi.fn().mockResolvedValue(overrides.rented ?? []) },
    // The two clock rules, read in one query: 60 min between logistics events, 120 min of washing.
    appPreference: { findMany: vi.fn().mockResolvedValue(TIMING_PREFERENCES) },
    service: {
      findMany: vi.fn().mockResolvedValue(overrides.driverCandidates ?? []),
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
  // REQUIRED since the logistics pad became a rule about a DRIVER's day (Q-D2): every event has
  // an owner, so the validator refuses a body without one.
  assignedUserId: 1,
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

  it("assigns the order to the CHOSEN staff member and checks THEIR day", async () => {
    const tx = mockCreateTx();
    // The assignee (validated as a deliverable user upstream) is used as-is — and is the resource
    // the logistics pad scopes over, so the conflict query asks about that person's day.
    await createOrder(
      buildCreateReq({ ...createBody(), assignedUserId: 7 } as ReturnType<typeof createBody>),
      {} as Response,
    );
    const createArg = (tx.service.create as Mock).mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(createArg.data["assignedUserId"]).toBe(7);
    expect(tx.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assignedUserId: 7 }) }),
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

  it("rolls back to a 409 naming the driver's clashing event, and says which of ours it blocks", async () => {
    const tx = mockCreateTx({
      driverCandidates: [driverEvent(9, "2026-08-01T14:30:00.000Z")],
    });
    await createOrder(buildCreateReq(createBody()), {} as Response);

    expect(tx.service.create).not.toHaveBeenCalled();
    // The payload is deliberately NOT `conflicts` (that shape belongs to stock and lands on a
    // line's quantity): a driver clash is about the DATES, and carries everything the form needs
    // to say so — which order, when, which of ours it blocks, who is busy, and the real gap.
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.createOrder.driverConflict",
      undefined,
      {
        driverConflict: {
          orderId: 9,
          at: new Date("2026-08-01T14:30:00.000Z"),
          kind: "DELIVERY",
          blocks: "DELIVERY",
          driverName: "Ana Ruiz",
          gapMinutes: 60,
        },
      },
    );
  });

  it("a candidate the SQL over-selected but the pads clear is not a conflict", async () => {
    // Exactly the configured gap away: touching blocks don't overlap ("minimum 1 hour BETWEEN"),
    // and the widened candidate query still returns it — this is the code-side refinement working.
    const tx = mockCreateTx({
      driverCandidates: [driverEvent(9, "2026-08-01T15:00:00.000Z")],
    });
    await createOrder(buildCreateReq(createBody()), {} as Response);

    expect(tx.service.create).toHaveBeenCalled();
    expect(sendOzariError).not.toHaveBeenCalled();
  });

  it("refuses an order whose OWN delivery and collection are too close together", async () => {
    // The hole this epic closes: on create the order isn't in the table yet, so nothing ever
    // compared its two events — a delivery at 14:00 with a collection at 14:15 saved happily,
    // though one driver physically cannot do both. Caught before any query runs.
    const tx = mockCreateTx();
    await createOrder(
      buildCreateReq({
        ...createBody(),
        pickupAt: new Date("2026-08-01T14:15:00.000Z"),
      }),
      {} as Response,
    );

    expect(tx.service.findMany).not.toHaveBeenCalled();
    expect(tx.service.create).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.createOrder.selfOverlap",
      undefined,
      { selfOverlap: { gapMinutes: 60 } },
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

// ── The full edit ────────────────────────────────────────────────────────────────────────────────

/** One SALE line already on the order (10 cups), so the stock-delta rules have something to move. */
const existingSaleLine = {
  id: 32,
  productId: 4,
  quantity: 10,
  isRental: false,
  unitaryPrice: new Prisma.Decimal("3.50"),
  parcialPrice: new Prisma.Decimal("35.00"),
  product: { name: "Vasos desechables" },
};

type UpdateTxOverrides = TxOverrides & {
  /** The order as it stands before the edit; `null` = it doesn't exist (the 404 path). */
  order?: Record<string, unknown> | null;
};

function mockUpdateTx(overrides: UpdateTxOverrides = {}) {
  const existing = overrides.order === undefined ? makeRawRichOrder() : overrides.order;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    product: {
      findMany: vi.fn().mockResolvedValue(overrides.products ?? [txRentalProduct, txSaleProduct]),
      update: vi.fn().mockResolvedValue({}),
    },
    serviceDetail: {
      groupBy: vi.fn().mockResolvedValue(overrides.rented ?? []),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    // The two clock rules, read in one query: 60 min between logistics events, 120 min of washing.
    appPreference: { findMany: vi.fn().mockResolvedValue(TIMING_PREFERENCES) },
    service: {
      // Loads the order under the lock; the driver-conflict candidates come from `findMany`.
      findFirst: vi.fn().mockResolvedValue(existing),
      findMany: vi.fn().mockResolvedValue(overrides.driverCandidates ?? []),
      update: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi.fn().mockResolvedValue(makeRawRichOrder()),
    },
  };
  (getPrismaClient as Mock).mockResolvedValue({
    $transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
  });
  return tx;
}

const buildUpdateReq = (
  body: ReturnType<typeof createBody>,
  id = "12",
): CustomRequest =>
  ({ body, query: {}, params: { id }, user: { userRole: 2, userId: 1 } }) as unknown as CustomRequest;

describe("updateOrder", () => {
  it("NEVER touches payment — a typo fix must not erase a recorded one", async () => {
    // The same boundary the lifecycle has: this endpoint rewrites what was AGREED, while what
    // HAPPENED (a move, a payment) belongs to its own door. A declarative full-state save that
    // included these would wipe `paidAt` every time somebody corrected an address.
    const tx = mockUpdateTx({ order: makeRawRichOrder() });
    await updateOrder(buildUpdateReq(createBody()), {} as Response);

    const updateArg = (tx.service.update as Mock).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data).not.toHaveProperty("paymentMethodId");
    expect(updateArg.data).not.toHaveProperty("paidAt");
    expect(updateArg.data).not.toHaveProperty("paymentStatusId");
  });

  it("re-prices from the NEW window, reconciles the lines by product, and moves sale stock by the DIFFERENCE", async () => {
    const tx = mockUpdateTx({ order: { ...makeRawRichOrder(), serviceDetails: [
      makeRawRichOrder().serviceDetails[0] as object,
      existingSaleLine,
    ] } });
    // 25 → 30 chairs, and the cups drop from 10 to 4.
    const body = {
      ...createBody(),
      lines: [
        { productId: 3, quantity: 30 },
        { productId: 4, quantity: 4 },
      ],
    };
    await updateOrder(buildUpdateReq(body), {} as Response);

    // The surviving product keeps its ROW (and its id) and is re-priced: 6 × 30 × 2 billed days.
    expect(tx.serviceDetail.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: { quantity: 30, isRental: true, unitaryPrice: 6, parcialPrice: 360, currencyId: 1 },
    });
    expect(tx.serviceDetail.update).toHaveBeenCalledWith({
      where: { id: 32 },
      data: { quantity: 4, isRental: false, unitaryPrice: 3.5, parcialPrice: 14, currencyId: 1 },
    });
    expect(tx.serviceDetail.create).not.toHaveBeenCalled();
    expect(tx.serviceDetail.deleteMany).not.toHaveBeenCalled();
    // Sale stock moves by the DIFFERENCE only: 10 held − 4 now = 6 units back on the shelf.
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { quantity: { increment: 6 } },
    });

    const updateArg = (tx.service.update as Mock).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data).toMatchObject({
      clientRegistryId: 3,
      eventTypeId: 1,
      totalAmount: 424, // 360 + 14 + 50 delivery
      deliveryAt: body.deliveryAt,
      serviceEnd: body.pickupAt,
    });
    // Snapshots are re-encrypted, never stored as plaintext.
    expect(updateArg.data["deliveryAddressKms"]).not.toBe(body.deliveryAddress);
    // The lifecycle is untouched: an edit never moves the status or writes history.
    expect(updateArg.data["serviceStatusId"]).toBeUndefined();
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "orders.updateOrder.orderUpdated",
      expect.objectContaining({ order: expect.objectContaining({ id: 12 }) }),
    );
  });

  it("deletes the rows of products that left the order and gives their sale units back", async () => {
    const tx = mockUpdateTx({
      order: { ...makeRawRichOrder(), serviceDetails: [existingSaleLine] },
    });
    await updateOrder(
      buildUpdateReq({ ...createBody(), lines: [{ productId: 3, quantity: 5 }] }),
      {} as Response,
    );

    expect(tx.serviceDetail.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [32] } } });
    expect(tx.serviceDetail.create).toHaveBeenCalledWith({
      data: {
        quantity: 5,
        isRental: true,
        unitaryPrice: 6,
        parcialPrice: 60,
        currencyId: 1,
        serviceId: 12,
        productId: 3,
      },
    });
    // The whole sale quantity comes back — that product is no longer on the order.
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { quantity: { increment: 10 } },
    });
  });

  it("excludes the order from its OWN availability and driver checks", async () => {
    const tx = mockUpdateTx();
    await updateOrder(buildUpdateReq(createBody()), {} as Response);

    // An order is holding its own current lines; without this it would conflict with itself.
    expect(tx.serviceDetail.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          service: expect.objectContaining({ id: { not: 12 } }),
        }),
      }),
    );
    // Same reason on the driver's day: the order already occupies exactly these blocks.
    expect(tx.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 12 } }) }),
    );
  });

  it("is a pure PAPERWORK edit on an order whose status reserves nothing", async () => {
    // Listo (6) holds no rental units and the goods were delivered, so nothing is reserved and
    // nothing can be given back — the edit can never fail on availability.
    const tx = mockUpdateTx({
      order: {
        ...makeRawRichOrder(),
        serviceStatusId: 6,
        deliveredAt: new Date("2026-08-01T15:00:00.000Z"),
        serviceDetails: [makeRawRichOrder().serviceDetails[0] as object, existingSaleLine],
      },
      // Even a fully-committed fleet cannot block it: this order competes for nothing.
      rented: [rentedRow(3, 40)],
    });
    await updateOrder(
      buildUpdateReq({ ...createBody(), lines: [{ productId: 3, quantity: 30 }] }),
      {} as Response,
    );

    expect(tx.serviceDetail.groupBy).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.service.update).toHaveBeenCalled();
  });

  it("asks the driver's day for NOTHING when the order will never be performed", async () => {
    // A cancelled order occupies nobody: correcting its dates is paperwork about something that is
    // not going to happen. The very clash that refuses a live edit must not refuse this one — the
    // same stance the stock rules take, now applied to the logistics pad too.
    const tx = mockUpdateTx({
      order: {
        ...makeRawRichOrder(),
        cancelledAt: new Date("2026-07-20T10:00:00.000Z"),
        serviceStatusId: 7,
      },
      driverCandidates: [driverEvent(9, "2026-08-01T14:10:00.000Z")],
    });
    await updateOrder(buildUpdateReq(createBody()), {} as Response);

    expect(tx.service.findMany).not.toHaveBeenCalled();
    expect(tx.service.update).toHaveBeenCalled();
  });

  it("still guards the half of a rental that HASN'T happened yet", async () => {
    // Delivered but not collected: the delivery is history, the collection is still a promise the
    // driver has to keep — so the pad is asked about the collection alone, and refuses.
    const tx = mockUpdateTx({
      order: { ...makeRawRichOrder(), deliveredAt: new Date("2026-08-01T14:05:00.000Z") },
      driverCandidates: [
        // Sits right on the (already performed) delivery — must be ignored…
        driverEvent(8, "2026-08-01T14:10:00.000Z"),
        // …while the still-pending collection at 15:00 on the 2nd is refused as usual.
        driverEvent(9, "2026-08-02T15:20:00.000Z"),
      ],
    });
    await updateOrder(buildUpdateReq(createBody()), {} as Response);

    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.updateOrder.driverConflict",
      undefined,
      expect.objectContaining({
        driverConflict: expect.objectContaining({ orderId: 9, blocks: "COLLECTION" }),
      }),
    );
  });

  it("never 409s on STOCK for an order that reserves nothing, however big the lines get", async () => {
    // The sale branch used to check the shelf even when the order held nothing — refusing a
    // correction that moves no stock whatsoever. 500 cups on a delivered order is paperwork, not a
    // claim on inventory.
    const tx = mockUpdateTx({
      order: {
        ...makeRawRichOrder(),
        deliveredAt: new Date("2026-08-01T15:00:00.000Z"),
        serviceStatusId: 6,
        serviceDetails: [existingSaleLine],
      },
      products: [txRentalProduct, { ...txSaleProduct, quantity: 2 }],
    });
    await updateOrder(
      buildUpdateReq({ ...createBody(), lines: [{ productId: 4, quantity: 500 }], pickupAt: undefined }),
      {} as Response,
    );

    expect(sendOzariError).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.service.update).toHaveBeenCalled();
  });

  it("lets a SALE line grow into the units the order itself is already holding", async () => {
    // The shelf shows 15 left, but this order is holding 10 of them — so 25 is reachable, and 26
    // is not. Checking against the raw shelf would have refused a change the business can make.
    const tx = mockUpdateTx({
      order: { ...makeRawRichOrder(), serviceDetails: [existingSaleLine] },
      products: [txRentalProduct, { ...txSaleProduct, quantity: 15 }],
    });
    await updateOrder(
      buildUpdateReq({ ...createBody(), lines: [{ productId: 4, quantity: 25 }], pickupAt: undefined }),
      {} as Response,
    );
    expect(tx.service.update).toHaveBeenCalled();

    vi.clearAllMocks();
    const tooMany = mockUpdateTx({
      order: { ...makeRawRichOrder(), serviceDetails: [existingSaleLine] },
      products: [txRentalProduct, { ...txSaleProduct, quantity: 15 }],
    });
    await updateOrder(
      buildUpdateReq({ ...createBody(), lines: [{ productId: 4, quantity: 26 }], pickupAt: undefined }),
      {} as Response,
    );
    expect(tooMany.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.updateOrder.stockConflict",
      undefined,
      { conflicts: [{ productId: 4, productName: "Vasos desechables", requested: 26, available: 25 }] },
    );
  });

  it("refuses with a STRUCTURED 409 when the new state outruns the window", async () => {
    const tx = mockUpdateTx({ rented: [rentedRow(3, 35)] });
    await updateOrder(buildUpdateReq(createBody()), {} as Response);

    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.updateOrder.stockConflict",
      undefined,
      {
        conflicts: [{ productId: 3, productName: "Silla plegable", requested: 25, available: 5 }],
      },
    );
  });

  it("refuses with a 409 when the new window crowds the driver's day", async () => {
    const tx = mockUpdateTx({
      // The clashing event is the other order's COLLECTION — the payload says so, so the form can
      // word it truthfully instead of always saying "entrega".
      driverCandidates: [driverEvent(9, "2026-07-30T09:00:00.000Z", "2026-08-01T14:20:00.000Z")],
    });
    await updateOrder(buildUpdateReq(createBody()), {} as Response);

    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.updateOrder.driverConflict",
      undefined,
      {
        driverConflict: {
          orderId: 9,
          at: new Date("2026-08-01T14:20:00.000Z"),
          kind: "COLLECTION",
          blocks: "DELIVERY",
          driverName: "Ana Ruiz",
          gapMinutes: 60,
        },
      },
    );
  });

  it("refuses with a 409 when the edited window puts the order's own two events too close", async () => {
    const tx = mockUpdateTx();
    await updateOrder(
      buildUpdateReq({ ...createBody(), pickupAt: new Date("2026-08-01T14:30:00.000Z") }),
      {} as Response,
    );

    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.updateOrder.selfOverlap",
      undefined,
      { selfOverlap: { gapMinutes: 60 } },
    );
  });

  it("treats a product that vanished before the lock as a conflict, not a 500", async () => {
    mockUpdateTx({ products: [txRentalProduct] });
    await updateOrder(
      buildUpdateReq({ ...createBody(), lines: [{ productId: 4, quantity: 1 }], pickupAt: undefined }),
      {} as Response,
    );

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.updateOrder.stockConflict",
      undefined,
      { conflicts: [{ productId: 4, productName: "#4", requested: 1, available: 0 }] },
    );
  });

  it("reassigns to the body's owner and re-checks THAT driver's day", async () => {
    // The form always sends the order's current assignee back, so saving an untouched form is not
    // a reassignment; deliberately changing the picker moves the order — and the pad is then a
    // question about the NEW driver, not the old one.
    const tx = mockUpdateTx({ order: { ...makeRawRichOrder(), assignedUserId: 7 } });
    await updateOrder(
      buildUpdateReq({ ...createBody(), assignedUserId: 5 } as ReturnType<typeof createBody>),
      {} as Response,
    );
    const updateArg = (tx.service.update as Mock).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data["assignedUserId"]).toBe(5);
    expect(tx.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assignedUserId: 5 }) }),
    );
  });

  it("answers a plain 404 for a malformed id and for an order that is not there", async () => {
    mockUpdateTx();
    await updateOrder(buildUpdateReq(createBody(), "abc"), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.updateOrder.orderNotFound",
    );

    vi.clearAllMocks();
    const tx = mockUpdateTx({ order: null });
    await updateOrder(buildUpdateReq(createBody()), {} as Response);
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.updateOrder.orderNotFound",
    );
  });

  it("responds 500 when the transaction fails for any other reason", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await updateOrder(buildUpdateReq(createBody()), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.updateOrder.errorUpdatingOrder",
    );
  });
});

describe("deleteOrder", () => {
  const KEY = "orders/evidence/a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7.jpg";

  function mockDeleteTx(order: unknown = {
    id: 12,
    cancelledAt: null,
    deliveredAt: null,
    serviceDetails: [
      { productId: 4, quantity: 10, isRental: false },
      { productId: 3, quantity: 25, isRental: true },
    ],
    evidences: [{ r2Key: KEY }],
  }) {
    const tx = {
      service: { findUnique: vi.fn().mockResolvedValue(order), delete: vi.fn().mockResolvedValue({}) },
      product: { update: vi.fn().mockResolvedValue({}) },
      serviceEvidence: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      serviceStatusHistory: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      serviceDetail: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      serviceExtra: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
    });
    return tx;
  }

  it("destroys the order and everything that existed only because of it, and gives back SALE stock", async () => {
    const deleteObjects = vi.fn().mockResolvedValue(undefined);
    (getStorage as Mock).mockReturnValue({ deleteObjects });
    const tx = mockDeleteTx();

    await deleteOrder(buildReq({}, { id: "12" }), {} as Response);

    // Sale units come back (the order never happened); the rental line takes nothing back — its
    // hold was derived from the status and vanishes with the row.
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { quantity: { increment: 10 } },
    });
    for (const child of [
      tx.serviceEvidence.deleteMany,
      tx.serviceStatusHistory.deleteMany,
      tx.serviceDetail.deleteMany,
      tx.serviceExtra.deleteMany,
    ]) {
      expect(child).toHaveBeenCalledWith({ where: { serviceId: 12 } });
    }
    expect(tx.service.delete).toHaveBeenCalledWith({ where: { id: 12 } });
    // The R2 objects go only AFTER the commit — a failure there leaves a sweepable orphan.
    expect(deleteObjects).toHaveBeenCalledWith([KEY]);
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "orders.deleteOrder.orderDeleted",
    );
  });

  it("survives a failed object cleanup — the deletion still succeeded", async () => {
    (getStorage as Mock).mockReturnValue({
      deleteObjects: vi.fn().mockRejectedValue(new Error("R2 down")),
    });
    mockDeleteTx();
    await deleteOrder(buildReq({}, { id: "12" }), {} as Response);
    expect(sendOzariSuccess).toHaveBeenCalled();
    expect(sendOzariError).not.toHaveBeenCalled();
  });

  it("never touches storage when the order had no photos", async () => {
    mockDeleteTx({ id: 12, cancelledAt: null, serviceDetails: [], evidences: [] });
    await deleteOrder(buildReq({}, { id: "12" }), {} as Response);
    expect(getStorage).not.toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalled();
  });

  it("does NOT restore a DELIVERED order's sale units — the client has them", async () => {
    // Deleting the paperwork of a completed sale can't bring the goods home; restoring would
    // invent stock that physically isn't there.
    const tx = mockDeleteTx({
      id: 12,
      cancelledAt: null,
      deliveredAt: new Date("2026-08-01T14:30:00.000Z"),
      serviceDetails: [{ productId: 4, quantity: 10, isRental: false }],
      evidences: [],
    });
    await deleteOrder(buildReq({}, { id: "12" }), {} as Response);

    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.service.delete).toHaveBeenCalled();
  });

  it("does NOT give sale stock back twice when the order was already cancelled", async () => {
    // Cancelling already handed those units back; giving them again would invent stock.
    const tx = mockDeleteTx({
      id: 12,
      cancelledAt: new Date("2026-07-20T10:00:00.000Z"),
      serviceDetails: [{ productId: 4, quantity: 10, isRental: false }],
      evidences: [],
    });
    await deleteOrder(buildReq({}, { id: "12" }), {} as Response);

    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.service.delete).toHaveBeenCalledWith({ where: { id: 12 } });
  });

  it("a malformed or unknown id is a plain 404, and a failure is a 500", async () => {
    await deleteOrder(buildReq({}, { id: "abc" }), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.deleteOrder.orderNotFound",
    );

    vi.clearAllMocks();
    mockDeleteTx(null);
    await deleteOrder(buildReq({}, { id: "99" }), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.deleteOrder.orderNotFound",
    );

    vi.clearAllMocks();
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await deleteOrder(buildReq({}, { id: "12" }), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.deleteOrder.errorDeletingOrder",
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
      // The probe answers with the same clock rules the create enforces (washing included).
      appPreference: { findMany: vi.fn().mockResolvedValue(TIMING_PREFERENCES) },
    });
    await getOrderAvailability(availabilityReq({ ...window, productIds: [3, 5, 6, 4] }), {} as Response);

    expect(groupBy).toHaveBeenCalled();
    const data = successData<OrderAvailabilityResponseModel>();
    expect(data.availability).toEqual([
      { productId: 3, available: 10 },
      { productId: 5, available: 15 },
      { productId: 6, available: 8 },
      { productId: 4, available: 120 },
    ]);
    // No assignee in the body ⇒ no driver block at all: the form has nothing to say until the
    // admin has reached that field, and nagging about it would be worse than silence.
    expect(data.driver).toBeUndefined();
  });

  /** The probe with its driver half wired: products resolve, `service.findMany` is the widened
   *  candidate query the code-side pads then refine, and `findUnique` is the order being edited
   *  (its actuals decide which of ITS events still occupy a day). */
  const mockAvailabilityPrisma = (
    candidates: ReturnType<typeof driverEvent>[],
    editing: {
      deliveredAt: Date | null;
      collectedAt: Date | null;
      cancelledAt: Date | null;
    } = { deliveredAt: null, collectedAt: null, cancelledAt: null },
  ) => {
    const findMany = vi.fn().mockResolvedValue(candidates);
    const groupBy = vi.fn().mockResolvedValue([]);
    (getPrismaClient as Mock).mockResolvedValue({
      product: {
        findMany: vi.fn().mockResolvedValue([{ id: 4, quantity: 120, productBusinessTypeId: 2 }]),
      },
      serviceDetail: { groupBy },
      appPreference: { findMany: vi.fn().mockResolvedValue(TIMING_PREFERENCES) },
      service: { findMany, findUnique: vi.fn().mockResolvedValue(editing) },
    });
    return { findMany, groupBy };
  };

  it("answers the DRIVER half when an assignee is sent — scoped to that person's day", async () => {
    const { findMany } = mockAvailabilityPrisma([driverEvent(42, "2026-08-01T14:30:00.000Z")]);
    await getOrderAvailability(
      availabilityReq({ ...window, productIds: [4], assignedUserId: 2, excludeOrderId: 12 }),
      {} as Response,
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignedUserId: 2, id: { not: 12 } }),
      }),
    );
    // Admin tier: exact counts, exactly like the product half — the admin runs the business.
    expect(successData<OrderAvailabilityResponseModel>().driver).toEqual({
      available: false,
      gapMinutes: 60,
      selfOverlap: false,
      conflicts: [
        {
          orderId: 42,
          at: new Date("2026-08-01T14:30:00.000Z"),
          kind: "DELIVERY",
          blocks: "DELIVERY",
        },
      ],
      // The probe names the driver too, so its copy and the save's 409 read the same.
      driverName: "Ana Ruiz",
    });
  });

  it("an EDIT asks the SAME question the save asks — its own units and blocks excluded", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const findMany = vi.fn().mockResolvedValue([]);
    (getPrismaClient as Mock).mockResolvedValue({
      product: {
        findMany: vi.fn().mockResolvedValue([{ id: 3, quantity: 30, productBusinessTypeId: 1 }]),
      },
      serviceDetail: { groupBy },
      appPreference: { findMany: vi.fn().mockResolvedValue(TIMING_PREFERENCES) },
      service: {
        findMany,
        findUnique: vi
          .fn()
          .mockResolvedValue({ deliveredAt: null, collectedAt: null, cancelledAt: null }),
      },
    });
    await getOrderAvailability(
      availabilityReq({ ...window, productIds: [3], assignedUserId: 2, excludeOrderId: 12 }),
      {} as Response,
    );

    // Without the exclusion the probe would answer a STRICTER question than the save: the order
    // competing with its own held units, so the form would cap lines the server was about to
    // accept — and the reconcile would quietly shrink the admin's own quantities.
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          service: expect.objectContaining({ id: { not: 12 } }),
        }),
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 12 } }) }),
    );
  });

  it("answers FREE, without asking, for an order that occupies nobody's day", async () => {
    // Editing a cancelled order: the save refuses nothing, so the probe must promise nothing —
    // otherwise the form would block a submit the server would have accepted.
    const { findMany } = mockAvailabilityPrisma([driverEvent(42, "2026-08-01T14:30:00.000Z")], {
      deliveredAt: null,
      collectedAt: null,
      cancelledAt: new Date("2026-07-20T10:00:00.000Z"),
    });
    await getOrderAvailability(
      availabilityReq({ ...window, productIds: [4], assignedUserId: 2, excludeOrderId: 12 }),
      {} as Response,
    );

    expect(findMany).not.toHaveBeenCalled();
    expect(successData<OrderAvailabilityResponseModel>().driver).toEqual({
      available: true,
      gapMinutes: 60,
      selfOverlap: false,
      conflicts: [],
    });
  });

  it("an event that already HAPPENED no longer occupies its driver", async () => {
    // The other order's delivery is done; the driver is free again at that hour. A completed
    // morning must not reserve the afternoon.
    mockAvailabilityPrisma([
      driverEvent(42, "2026-08-01T14:30:00.000Z", null, {
        deliveredAt: "2026-08-01T14:35:00.000Z",
      }),
    ]);
    await getOrderAvailability(
      availabilityReq({ ...window, productIds: [4], assignedUserId: 2 }),
      {} as Response,
    );

    expect(successData<OrderAvailabilityResponseModel>().driver).toMatchObject({
      available: true,
      conflicts: [],
    });
  });

  it("reports the order's own two events colliding, with a free driver", async () => {
    mockAvailabilityPrisma([]);
    await getOrderAvailability(
      availabilityReq({
        deliveryAt: window.deliveryAt,
        pickupAt: new Date("2026-08-01T14:30:00.000Z"),
        productIds: [4],
        assignedUserId: 2,
      }),
      {} as Response,
    );

    const driver = successData<OrderAvailabilityResponseModel>().driver;
    expect(driver).toMatchObject({ available: false, selfOverlap: true, conflicts: [] });
  });

  it("returns null for rentals when there is NO pickup window (skips the groupBy query)", async () => {
    const groupBy = vi.fn();
    (getPrismaClient as Mock).mockResolvedValue({
      product: { findMany: vi.fn().mockResolvedValue([{ id: 3, quantity: 30, productBusinessTypeId: 1 }]) },
      serviceDetail: { groupBy },
      // The probe answers with the same clock rules the create enforces (washing included).
      appPreference: { findMany: vi.fn().mockResolvedValue(TIMING_PREFERENCES) },
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
