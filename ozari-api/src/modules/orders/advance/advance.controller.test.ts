import { describe, it, expect, vi, beforeAll, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/services/prisma.service.js";
import { getStorage, StorageValidationError } from "@helpers/storage.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { encryptKms } from "@helpers/encryption.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import {
  DEFAULT_EVIDENCE_BOUNDS,
  SEEDED_STATUS_CATALOG,
} from "@/tests/fixtures/lifecycleCatalog.js";
import { type OrderDetailEnvelopeModel } from "../orders.models.js";
import { advanceOrder, createOrderEvidenceUploads } from "./advance.controller.js";

vi.mock("@/config/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariSuccessModel.js", () => ({ sendOzariSuccess: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));
vi.mock("@/config/auditLogger.js", () => ({
  AuditAction: { ADMIN_ACTION: "ADMIN_ACTION" },
  logAudit: vi.fn(),
}));
vi.mock("@/config/environment.js", () => ({
  isDeployedEnvironment: vi.fn(() => false),
}));
vi.mock("@helpers/storage.js", () => ({
  getStorage: vi.fn(),
  StorageValidationError: class StorageValidationError extends Error {},
}));
// Only the lifecycle's DB readers are stubbed — the engine's decisions run for real.
vi.mock("../lifecycle/lifecycle.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lifecycle/lifecycle.service.js")>()),
  getStatusCatalog: vi.fn(async () => SEEDED_STATUS_CATALOG),
  getEvidenceBounds: vi.fn(async () => DEFAULT_EVIDENCE_BOUNDS),
}));

const VALID_ENCRYPTION_KEY =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] = VALID_ENCRYPTION_KEY;
});

/** The locked order row, as `richOrderInclude` fetches it. */
const rawOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  userId: null,
  clientRegistryId: 3,
  deliveryNameKms: encryptKms("María López"),
  deliveryContactKms: encryptKms("WhatsApp 5555-1234"),
  deliveryAddressKms: encryptKms("Zona 10"),
  description: null,
  eventTypeId: 1,
  deliveryAt: new Date("2026-08-01T14:00:00.000Z"),
  pickupAt: new Date("2026-08-02T10:00:00.000Z"),
  deliveredAt: null,
  collectedAt: null,
  readyAt: null,
  serviceStart: new Date("2026-08-01T14:00:00.000Z"),
  serviceEnd: new Date("2026-08-02T10:00:00.000Z"),
  assignedUserId: 7,
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
  paymentMethodId: null,
  comment: null,
  invoiceNumberKms: null,
  isActive: true,
  updatedAt: null,
  createdAt: new Date("2026-07-16T12:00:00.000Z"),
  eventType: { id: 1, name: "Evento familiar" },
  serviceStatus: { id: 1, name: "Pendiente" },
  paymentStatus: { id: 1, name: "Pendiente" },
  paymentMethod: null,
  currency: { id: 1, iso4217Code: "GTQ", name: "Quetzal", symbol: "Q" },
  assignedUser: null,
  serviceDetails: [
    {
      id: 31,
      productId: 3,
      variantId: null,
      variantLabel: null,
      quantity: 25,
      isRental: true,
      unitaryPrice: new Prisma.Decimal("6.00"),
      parcialPrice: new Prisma.Decimal("150.00"),
      securityDeposit: null,
      replacementPrice: null,
      damagedQuantity: 0,
      damageNote: null,
      product: { name: "Silla plegable", productImages: [] },
    },
  ],
  serviceExtras: [],
  statusHistory: [],
  depositHistory: [],
  evidences: [],
  ...overrides,
});

function mockTx(order: ReturnType<typeof rawOrder> | null = rawOrder()) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    service: {
      findFirst: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi.fn().mockResolvedValue(rawOrder()),
      // The driver-conflict candidate query: only reached when a move GIVES WORK BACK (reopen or
      // rewind) and the order still has upcoming events.
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Backward steps look up (and destroy) the photos of the step being undone.
    serviceEvidence: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    // Sale stock moves on cancel/reopen; reopening also re-checks the rental fleet.
    product: {
      findMany: vi.fn().mockResolvedValue([
        { id: 3, name: "Silla plegable", quantity: 40, variants: [] as Array<{ id: number; quantity: number }> },
        { id: 4, name: "Vasos desechables", quantity: 100, variants: [] as Array<{ id: number; quantity: number }> },
      ]),
      update: vi.fn().mockResolvedValue({}),
    },
    serviceDetail: { groupBy: vi.fn().mockResolvedValue([]) },
    // The deposit answered at the door leaves its trail row here.
    serviceDepositHistory: { create: vi.fn().mockResolvedValue({}) },
    // A reopen re-checks the fleet under the same clock rules a create uses (washing included).
    appPreference: {
      findMany: vi.fn().mockResolvedValue([
        { key: "orders.logisticsSpacingMinutes", value: "60" },
        { key: "orders.turnaroundMinutes", value: "120" },
      ]),
    },
  };
  (getPrismaClient as Mock).mockResolvedValue({
    $transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
    // The projection context re-reads nothing else (catalog + bounds are stubbed).
  });
  return tx;
}

const KEY = "orders/evidence/a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7.jpg";

const buildReq = (
  body: Record<string, unknown>,
  params: Record<string, string> = { id: "12" },
  user: { userRole: RolesEnum; userId: number } = {
    userRole: RolesEnum.Admin,
    userId: 1,
  },
): CustomRequest =>
  ({
    body: { evidence: [], reason: undefined, ...body },
    params,
    query: {},
    user,
  }) as unknown as CustomRequest;

const updateData = (tx: ReturnType<typeof mockTx>): Record<string, unknown> =>
  ((tx.service.update as Mock).mock.calls[0]?.[0] as { data: Record<string, unknown> })
    .data;

beforeEach(() => {
  vi.clearAllMocks();
  (getStorage as Mock).mockReturnValue({
    getPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
    createUpload: vi.fn(),
  });
});

describe("advanceOrder", () => {
  it("advances the order under a row lock, writing the status, its actual and the audit row", async () => {
    // Pendiente → En ruta: no evidence demanded, no actual tracked by that step.
    const tx = mockTx();
    await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

    expect(tx.$queryRaw).toHaveBeenCalled(); // SELECT … FOR UPDATE
    const data = updateData(tx);
    expect(data["serviceStatus"]).toEqual({ connect: { id: 5 } });
    expect(data["statusHistory"]).toEqual({
      create: { fromStatusId: 1, toStatusId: 5, byUserId: 1 },
    });
    expect(data["evidences"]).toBeUndefined();
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "orders.advance.orderAdvanced",
      expect.objectContaining({ order: expect.objectContaining({ id: 12 }) }),
    );
  });

  it("stores the evidence against the phase being entered, with a SERVER-derived url", async () => {
    const tx = mockTx(rawOrder({ serviceStatusId: 5, serviceStatus: { id: 5, name: "En ruta" } }));
    await advanceOrder(
      buildReq({ toStatusId: 3, evidence: [{ statusId: 3, keys: [KEY] }] }),
      {} as Response,
    );

    const data = updateData(tx);
    expect(data["evidences"]).toEqual({
      create: [
        {
          serviceStatusId: 3,
          r2Key: KEY,
          url: `https://cdn.example.com/${KEY}`,
        },
      ],
    });
    // Entering Entregado stamps the delivery actual it declares.
    expect(data["deliveredAt"]).toBeInstanceOf(Date);
  });

  describe("the deposit, asked at the delivery", () => {
    /** En ruta, 5 chairs carrying a Q40 deposit each (Q200), collection still PENDING. */
    const onTheWay = (overrides: Record<string, unknown> = {}) =>
      rawOrder({
        serviceStatusId: 5,
        serviceStatus: { id: 5, name: "En ruta" },
        serviceDetails: [
          {
            id: 31,
            productId: 3,
            variantId: null,
            variantLabel: null,
            quantity: 5,
            isRental: true,
            unitaryPrice: new Prisma.Decimal("6.00"),
            parcialPrice: new Prisma.Decimal("30.00"),
            securityDeposit: new Prisma.Decimal("40"),
            replacementPrice: new Prisma.Decimal("120"),
            damagedQuantity: 0,
            damageNote: null,
            product: { name: "Silla plegable", productImages: [] },
          },
        ],
        ...overrides,
      });
    const deliver = (depositCollection?: Record<string, unknown>, toStatusId = 3) =>
      buildReq({
        toStatusId,
        evidence: toStatusId === 3 ? [{ statusId: 3, keys: [KEY] }] : [],
        ...(depositCollection && { depositCollection }),
      });
    /** The collection write is the update AFTER the status step's. */
    const collectionWrite = (tx: ReturnType<typeof mockTx>) =>
      (tx.service.update as Mock).mock.calls[1]?.[0] as { data: Record<string, unknown> } | undefined;

    it("records a RECEIVED deposit with the delivery, in the same transaction", async () => {
      const tx = mockTx(onTheWay());
      await advanceOrder(deliver({ received: true, reason: undefined }), {} as Response);

      expect(collectionWrite(tx)?.data).toEqual({
        depositReceivedAt: expect.any(Date),
        depositWaivedAt: null,
        depositWaivedReason: null,
      });
      expect(tx.serviceDepositHistory.create).toHaveBeenCalledWith({
        data: { serviceId: 12, kind: "RECEIVED", note: null, depositTotal: 200, byUserId: 1 },
      });
      expect(sendOzariSuccess).toHaveBeenCalled();
    });

    it("records a WAIVED deposit with its reason", async () => {
      const tx = mockTx(onTheWay());
      await advanceOrder(deliver({ received: false, reason: "Un familiar" }), {} as Response);
      expect(tx.serviceDepositHistory.create).toHaveBeenCalledWith({
        data: { serviceId: 12, kind: "WAIVED", note: "Un familiar", depositTotal: 200, byUserId: 1 },
      });
    });

    it("never blocks the delivery when the answer is absent", async () => {
      const tx = mockTx(onTheWay());
      await advanceOrder(deliver(), {} as Response);
      expect(tx.service.update).toHaveBeenCalledTimes(1);
      expect(tx.serviceDepositHistory.create).not.toHaveBeenCalled();
      expect(sendOzariSuccess).toHaveBeenCalled();
    });

    // Factories, not rows: building a row encrypts, and the key is only set in `beforeAll`.
    const EARLIER = new Date("2026-07-30T10:00:00Z");
    it.each([
      ["the move is not the delivery", () => onTheWay({ serviceStatusId: 1, serviceStatus: { id: 1, name: "Pendiente" } }), 5],
      ["the deposit was already received", () => onTheWay({ depositReceivedAt: EARLIER }), 3],
      ["the deposit was already waived", () => onTheWay({ depositWaivedAt: EARLIER }), 3],
      ["the order carries no deposit", () => rawOrder({ serviceStatusId: 5, serviceStatus: { id: 5, name: "En ruta" } }), 3],
    ])("silently ignores the answer when %s — and still moves", async (_label, makeOrder, toStatusId) => {
      const tx = mockTx(makeOrder());
      await advanceOrder(deliver({ received: false, reason: "x" }, toStatusId), {} as Response);
      expect(tx.serviceDepositHistory.create).not.toHaveBeenCalled();
      expect(tx.service.update).toHaveBeenCalledTimes(1);
      expect(sendOzariSuccess).toHaveBeenCalled();
    });
  });

  it("refuses a step that demands photos when none were uploaded (422)", async () => {
    const tx = mockTx(rawOrder({ serviceStatusId: 5, serviceStatus: { id: 5, name: "En ruta" } }));
    await advanceOrder(buildReq({ toStatusId: 3 }), {} as Response);

    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.UNPROCESSABLE_ENTITY,
      "orders.advance.evidence",
    );
  });

  it("a DRIVER may advance and cancel their own order", async () => {
    const driver = { userRole: RolesEnum.Driver, userId: 7 };
    const tx = mockTx();
    await advanceOrder(buildReq({ toStatusId: 5 }, { id: "12" }, driver), {} as Response);
    expect(tx.service.update).toHaveBeenCalled();

    vi.clearAllMocks();
    const cancelTx = mockTx();
    await advanceOrder(
      buildReq({ toStatusId: 2, reason: "No había nadie" }, { id: "12" }, driver),
      {} as Response,
    );
    expect(updateData(cancelTx)).toMatchObject({
      serviceStatus: { connect: { id: 2 } },
      cancelReason: "No había nadie",
    });
  });

  it("a driver gets 403 on someone else's order, and on a rewind of their own", async () => {
    const stranger = { userRole: RolesEnum.Driver, userId: 99 };
    mockTx();
    await advanceOrder(buildReq({ toStatusId: 5 }, { id: "12" }, stranger), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.FORBIDDEN,
      "orders.advance.forbidden",
    );

    vi.clearAllMocks();
    mockTx(rawOrder({ serviceStatusId: 5, serviceStatus: { id: 5, name: "En ruta" } }));
    await advanceOrder(
      buildReq({ toStatusId: 1 }, { id: "12" }, { userRole: RolesEnum.Driver, userId: 7 }),
      {} as Response,
    );
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.FORBIDDEN,
      "orders.advance.forbidden",
    );
  });

  it("an ADMIN jump walks EVERY step in between, each with its own history row and photos", async () => {
    // Pendiente → Recolectado is three real transitions; the evidence arrives per step in one pass.
    const tx = mockTx();
    await advanceOrder(
      buildReq({
        toStatusId: 4,
        evidence: [
          { statusId: 3, keys: [KEY] },
          { statusId: 4, keys: [KEY.replace("a1b2", "b2c3")] },
        ],
      }),
      {} as Response,
    );

    const updates = (tx.service.update as Mock).mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data,
    );
    expect(updates).toHaveLength(3);
    expect(updates.map((data) => (data["serviceStatus"] as { connect: { id: number } }).connect.id))
      .toEqual([5, 3, 4]);
    // The trail records the WALK — from each step to the next, never a single leap.
    expect(updates.map((data) => (data["statusHistory"] as { create: { fromStatusId: number } }).create.fromStatusId))
      .toEqual([1, 5, 3]);
    // Each demanding step keeps its own photos, and the actuals are stamped along the way.
    expect(updates[1]?.["deliveredAt"]).toBeInstanceOf(Date);
    expect(updates[2]?.["collectedAt"]).toBeInstanceOf(Date);
    expect(sendOzariSuccess).toHaveBeenCalled();
  });

  it("a rewind DESTROYS the photos of the step it undoes (rows now, objects after the commit)", async () => {
    const deleteObjects = vi.fn().mockResolvedValue(undefined);
    (getStorage as Mock).mockReturnValue({
      getPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
      deleteObjects,
    });
    const tx = mockTx(
      rawOrder({ serviceStatusId: 3, serviceStatus: { id: 3, name: "Entregado" } }),
    );
    (tx.serviceEvidence.findMany as Mock).mockResolvedValue([{ r2Key: KEY }]);

    await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

    // The rows go inside the transaction…
    expect(tx.serviceEvidence.deleteMany).toHaveBeenCalledWith({
      where: { serviceId: 12, serviceStatusId: 3 },
    });
    // …the objects only after it commits, and the undone actual is cleared.
    expect(deleteObjects).toHaveBeenCalledWith([KEY]);
    expect(updateData(tx)["deliveredAt"]).toBeNull();
  });

  it("CANCELLING gives the sale units back — and rentals need no write at all", async () => {
    // A mixed order: one rental line, one sale line.
    const tx = mockTx(
      rawOrder({
        serviceDetails: [
          {
            id: 31,
            productId: 3,
            variantId: null,
            variantLabel: null,
            quantity: 25,
            isRental: true,
            unitaryPrice: new Prisma.Decimal("6.00"),
            parcialPrice: new Prisma.Decimal("150.00"),
            product: { name: "Silla plegable", productImages: [] },
          },
          {
            id: 32,
            productId: 4,
            variantId: null,
            variantLabel: null,
            quantity: 10,
            isRental: false,
            unitaryPrice: new Prisma.Decimal("3.50"),
            parcialPrice: new Prisma.Decimal("35.00"),
            product: { name: "Vasos", productImages: [] },
          },
        ],
      }),
    );
    await advanceOrder(
      buildReq({ toStatusId: 2, reason: "El cliente canceló" }),
      {} as Response,
    );

    // ONLY the sale line moves a number; the rental's hold is released by the status itself.
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { quantity: { increment: 10 } },
    });
  });

  describe("giving work back to a driver", () => {
    /** Far enough ahead that these stay UPCOMING however long this suite lives. */
    const FUTURE_DELIVERY = new Date("2030-08-01T14:00:00.000Z");
    const FUTURE_PICKUP = new Date("2030-08-02T10:00:00.000Z");

    it("refuses a REOPEN when the driver's day has filled up meanwhile", async () => {
      const tx = mockTx(
        rawOrder({
          serviceStatusId: 2,
          serviceStatus: { id: 2, name: "Cancelado" },
          cancelledAt: new Date("2030-07-20T10:00:00.000Z"),
          assignedUserId: 5,
          deliveryAt: FUTURE_DELIVERY,
          pickupAt: FUTURE_PICKUP,
          serviceDetails: [],
        }),
      );
      // Somebody else was promised that hour while this order was cancelled.
      tx.service.findMany.mockResolvedValue([
        {
          id: 99,
          deliveryAt: new Date("2030-08-01T14:20:00.000Z"),
          pickupAt: null,
          deliveredAt: null,
          collectedAt: null,
          assignedUser: { fullNameKms: encryptKms("Ana Ruiz") },
        },
      ]);

      await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

      // Refused BEFORE any write — the same payload shape create and edit answer with.
      expect(tx.service.update).not.toHaveBeenCalled();
      expect(sendOzariError).toHaveBeenCalledWith(
        expect.anything(),
        HttpEnum.CONFLICT,
        "orders.advance.driverConflict",
        undefined,
        expect.objectContaining({
          driverConflict: expect.objectContaining({ orderId: 99, driverName: "Ana Ruiz" }),
        }),
      );
    });

    it("never asks about a move whose events are all in the PAST", async () => {
      // Rewinding a long-finished order is record-keeping. The admin cannot move time, so refusing
      // it over a historical clash would be a dead end with no possible correction.
      const tx = mockTx(
        rawOrder({
          serviceStatusId: 4,
          serviceStatus: { id: 4, name: "Recolectado" },
          assignedUserId: 5,
          deliveryAt: new Date("2020-01-01T14:00:00.000Z"),
          pickupAt: new Date("2020-01-02T10:00:00.000Z"),
          deliveredAt: new Date("2020-01-01T14:05:00.000Z"),
          collectedAt: new Date("2020-01-02T10:05:00.000Z"),
        }),
      );

      await advanceOrder(buildReq({ toStatusId: 3 }), {} as Response);

      expect(tx.service.findMany).not.toHaveBeenCalled();
      expect(tx.service.update).toHaveBeenCalled();
    });

    it("leaves FORWARD moves alone — they only ever stamp actuals", async () => {
      const tx = mockTx(
        rawOrder({ assignedUserId: 5, deliveryAt: FUTURE_DELIVERY, pickupAt: FUTURE_PICKUP }),
      );

      await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

      // Confirming a step can only REMOVE occupancy, so there is nothing to re-check.
      expect(tx.service.findMany).not.toHaveBeenCalled();
      expect(sendOzariSuccess).toHaveBeenCalled();
    });
  });

  it("REOPENING re-takes the sale units, after re-checking the fleet it would hold again", async () => {
    const tx = mockTx(
      rawOrder({
        serviceStatusId: 2,
        serviceStatus: { id: 2, name: "Cancelado" },
        cancelledAt: new Date("2026-07-20T10:00:00.000Z"),
        serviceDetails: [
          {
            id: 32,
            productId: 4,
            variantId: null,
            variantLabel: null,
            quantity: 10,
            isRental: false,
            unitaryPrice: new Prisma.Decimal("3.50"),
            parcialPrice: new Prisma.Decimal("35.00"),
            product: { name: "Vasos", productImages: [] },
          },
        ],
      }),
    );
    await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

    // The products are LOCKED before the check, then the sale units are taken again.
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { quantity: { increment: -10 } },
    });
    expect(sendOzariSuccess).toHaveBeenCalled();
  });

  it("REFUSES to reopen when the goods were promised elsewhere meanwhile (structured 409)", async () => {
    const tx = mockTx(
      rawOrder({
        serviceStatusId: 2,
        serviceStatus: { id: 2, name: "Cancelado" },
        cancelledAt: new Date("2026-07-20T10:00:00.000Z"),
      }),
    );
    // The fleet is now fully committed for this order's window. (A null-sum row — a group with no
    // quantity — counts as zero held, like everywhere else availability is derived.)
    (tx.serviceDetail.groupBy as Mock).mockResolvedValue([
      { productId: 3, variantId: null, _sum: { quantity: 40 } },
      { productId: 99, variantId: null, _sum: { quantity: null } },
    ]);

    await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.advance.stockConflict",
      undefined,
      {
        conflicts: [
          { productId: 3, productName: "Silla plegable", requested: 25, available: 0 },
        ],
      },
    );
  });

  it("REFUSES to reopen when a line's product no longer exists at all", async () => {
    const tx = mockTx(
      rawOrder({
        serviceStatusId: 2,
        serviceStatus: { id: 2, name: "Cancelado" },
        cancelledAt: new Date("2026-07-20T10:00:00.000Z"),
      }),
    );
    (tx.product.findMany as Mock).mockResolvedValue([]); // deleted while it sat cancelled

    await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.advance.stockConflict",
      undefined,
      { conflicts: [{ productId: 3, productName: "#3", requested: 25, available: 0 }] },
    );
  });

  describe("reopening VARIANT lines", () => {
    const cancelledWith = (serviceDetails: unknown[]) =>
      rawOrder({
        serviceStatusId: 2,
        serviceStatus: { id: 2, name: "Cancelado" },
        cancelledAt: new Date("2026-07-20T10:00:00.000Z"),
        serviceDetails: serviceDetails as ReturnType<typeof rawOrder>["serviceDetails"],
      });
    const variantLine = (overrides: Record<string, unknown>) => ({
      id: 33,
      productId: 7,
      variantId: 71,
      variantLabel: "Rojo",
      quantity: 3,
      isRental: false,
      unitaryPrice: new Prisma.Decimal("3.50"),
      parcialPrice: new Prisma.Decimal("10.50"),
      securityDeposit: null,
      replacementPrice: null,
      damagedQuantity: 0,
      damageNote: null,
      product: { name: "Mantel", productImages: [] },
      variant: null,
      ...overrides,
    });

    it("re-takes a variant's sale units from ITS shelf", async () => {
      const tx = mockTx(cancelledWith([variantLine({})])) as ReturnType<typeof mockTx> & {
        productVariant: { updateMany: Mock };
      };
      tx.productVariant = { updateMany: vi.fn().mockResolvedValue({}) };
      Object.assign(tx.product, { updateMany: vi.fn().mockResolvedValue({}) });
      (tx.product.findMany as Mock).mockResolvedValue([
        { id: 7, name: "Mantel", quantity: 0, sharedStock: false, variants: [{ id: 71, quantity: 5 }] },
      ]);
      await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

      expect(tx.productVariant.updateMany).toHaveBeenCalledWith({
        where: { id: 71, product: { sharedStock: false } },
        data: { quantity: { increment: -3 } },
      });
      expect(tx.product.update).not.toHaveBeenCalled();
      expect(sendOzariSuccess).toHaveBeenCalled();
    });

    it("judges a SHARED pool once, on the sum of its lines, and names the product", async () => {
      const tx = mockTx(
        cancelledWith([
          variantLine({ id: 33, productId: 9, variantId: 91, variantLabel: "Sin flores", isRental: true, quantity: 2 }),
          variantLine({ id: 34, productId: 9, variantId: 92, variantLabel: "Con flores", isRental: true, quantity: 2 }),
        ]),
      );
      (tx.product.findMany as Mock).mockResolvedValue([
        {
          id: 9,
          name: "Arreglo floral",
          quantity: 5,
          sharedStock: true,
          variants: [
            { id: 91, quantity: 0 },
            { id: 92, quantity: 0 },
          ],
        },
      ]);
      // Held elsewhere across BOTH configurations: 1 + 1 of the 5 shared units.
      (tx.serviceDetail.groupBy as Mock).mockResolvedValue([
        { productId: 9, variantId: 91, _sum: { quantity: 1 } },
        { productId: 9, variantId: 92, _sum: { quantity: 1 } },
      ]);
      await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

      expect(sendOzariError).toHaveBeenCalledWith(
        expect.anything(),
        HttpEnum.CONFLICT,
        "orders.advance.stockConflict",
        undefined,
        { conflicts: [{ productId: 9, productName: "Arreglo floral", requested: 4, available: 3 }] },
      );
    });

    it("checks a variant RENTAL against its own fleet, and names it in the 409", async () => {
      const tx = mockTx(
        cancelledWith([variantLine({ productId: 8, variantId: 81, variantLabel: "Dorada", isRental: true, quantity: 4 })]),
      );
      (tx.product.findMany as Mock).mockResolvedValue([
        { id: 8, name: "Silla Tiffany", quantity: 0, variants: [{ id: 81, quantity: 10 }] },
      ]);
      // 8 of the gold chairs are held elsewhere (the product-level row does not count against it).
      (tx.serviceDetail.groupBy as Mock).mockResolvedValue([
        { productId: 8, variantId: 81, _sum: { quantity: 8 } },
        { productId: 8, variantId: null, _sum: { quantity: 30 } },
      ]);
      await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

      expect(sendOzariError).toHaveBeenCalledWith(
        expect.anything(),
        HttpEnum.CONFLICT,
        "orders.advance.stockConflict",
        undefined,
        {
          conflicts: [
            {
              productId: 8,
              productName: "Silla Tiffany",
              variantId: 81,
              variantLabel: "Dorada",
              requested: 4,
              available: 2,
            },
          ],
        },
      );
    });

    it("REFUSES to reopen onto a variant RETIRED meanwhile — available 0, label quoted", async () => {
      const tx = mockTx(cancelledWith([variantLine({})]));
      // The product is still there, but variant 71 is no longer one of its ACTIVE variants.
      (tx.product.findMany as Mock).mockResolvedValue([
        { id: 7, name: "Mantel", quantity: 0, variants: [{ id: 72, quantity: 9 }] },
      ]);
      await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

      expect(tx.service.update).not.toHaveBeenCalled();
      expect(sendOzariError).toHaveBeenCalledWith(
        expect.anything(),
        HttpEnum.CONFLICT,
        "orders.advance.stockConflict",
        undefined,
        {
          conflicts: [
            {
              productId: 7,
              productName: "Mantel",
              variantId: 71,
              variantLabel: "Rojo",
              requested: 3,
              available: 0,
            },
          ],
        },
      );
    });
  });

  it("reopens an order with NO lines without touching stock at all", async () => {
    const tx = mockTx(
      rawOrder({
        serviceStatusId: 2,
        serviceStatus: { id: 2, name: "Cancelado" },
        cancelledAt: new Date("2026-07-20T10:00:00.000Z"),
        serviceDetails: [],
      }),
    );
    await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

    // Only the ORDER row is locked — no product lock, no stock query, nothing to re-take.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalled();
  });

  it("REOPENS a cancelled order onto a chosen step, clearing the cancellation", async () => {
    const tx = mockTx(
      rawOrder({
        serviceStatusId: 2,
        serviceStatus: { id: 2, name: "Cancelado" },
        cancelledAt: new Date("2026-07-20T10:00:00.000Z"),
        cancelReason: "El cliente canceló",
      }),
    );
    await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);

    expect(updateData(tx)).toMatchObject({
      serviceStatus: { connect: { id: 5 } },
      cancelledAt: null,
      cancelReason: null,
    });
  });

  it("a move nobody could make from here is a 409, not a 403", async () => {
    // A purchase-only order can never reach a RENTAL-only step — illegal for every actor.
    const tx = mockTx(
      rawOrder({
        serviceDetails: [
          {
            id: 31,
            productId: 4,
            variantId: null,
            variantLabel: null,
            quantity: 10,
            isRental: false,
            unitaryPrice: new Prisma.Decimal("3.50"),
            parcialPrice: new Prisma.Decimal("35.00"),
            product: { name: "Vasos", productImages: [] },
          },
        ],
      }),
    );
    await advanceOrder(buildReq({ toStatusId: 4 }), {} as Response);

    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.advance.invalid",
    );
  });

  it("an unknown target status is a 409 without touching the DB", async () => {
    const tx = mockTx();
    await advanceOrder(buildReq({ toStatusId: 999 }), {} as Response);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.advance.invalid",
    );
  });

  it("a malformed or unknown order id is a plain 404", async () => {
    const tx = mockTx();
    await advanceOrder(buildReq({ toStatusId: 5 }, { id: "abc" }), {} as Response);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.advance.notFound",
    );

    vi.clearAllMocks();
    mockTx(null);
    await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.advance.notFound",
    );
  });

  it("responds 500 when the transaction fails for any other reason", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await advanceOrder(buildReq({ toStatusId: 5 }), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.advance.errorAdvancing",
    );
  });
});

describe("createOrderEvidenceUploads", () => {
  it("mints one presigned PUT per file, under the orders' evidence prefix", async () => {
    const createUpload = vi.fn(async () => ({
      uploadUrl: "https://r2.example.com/put",
      key: KEY,
      publicUrl: `https://cdn.example.com/${KEY}`,
    }));
    (getStorage as Mock).mockReturnValue({ createUpload });

    await createOrderEvidenceUploads(
      buildReq({ files: [{ contentType: "image/webp", contentLength: 2048 }] }),
      {} as Response,
    );

    expect(createUpload).toHaveBeenCalledWith({
      kind: "orderEvidence",
      contentType: "image/webp",
      contentLength: 2048,
    });
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "orders.evidenceUploads.uploadsCreated",
      { uploads: [expect.objectContaining({ key: KEY })] },
    );
  });

  it("maps a storage POLICY violation to a 400, and anything else to a 500", async () => {
    (getStorage as Mock).mockReturnValue({
      createUpload: vi.fn().mockRejectedValue(new StorageValidationError("too big")),
    });
    await createOrderEvidenceUploads(
      buildReq({ files: [{ contentType: "image/tiff", contentLength: 9 }] }),
      {} as Response,
    );
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.BAD_REQUEST,
      "orders.evidenceUploads.validators.invalidFiles",
    );

    vi.clearAllMocks();
    (getStorage as Mock).mockImplementation(() => {
      throw new Error("R2 not configured");
    });
    await createOrderEvidenceUploads(
      buildReq({ files: [{ contentType: "image/webp", contentLength: 9 }] }),
      {} as Response,
    );
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.evidenceUploads.errorCreatingUploads",
    );
  });
});
