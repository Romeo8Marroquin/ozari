import { describe, it, expect, vi, beforeAll, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "@/services/prisma.service.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { encryptKms } from "@helpers/encryption.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import type { DepositCollectionRequestModel } from "../orders.models.js";
import {
  DEFAULT_EVIDENCE_BOUNDS,
  SEEDED_STATUS_CATALOG,
} from "@/tests/fixtures/lifecycleCatalog.js";
import {
  clearDepositCollection,
  recordDepositCollection,
} from "./depositCollection.controller.js";

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
vi.mock("../lifecycle/lifecycle.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lifecycle/lifecycle.service.js")>()),
  getStatusCatalog: vi.fn(async () => SEEDED_STATUS_CATALOG),
  getEvidenceBounds: vi.fn(async () => DEFAULT_EVIDENCE_BOUNDS),
}));

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] = "a".repeat(64);
});
beforeEach(() => vi.clearAllMocks());

const DELIVERED = new Date("2026-08-01T15:00:00.000Z");
const dec = (value: string) => new Prisma.Decimal(value);

/** The locked state the door decides on: 5 chairs × Q40 = Q200 of deposit, still PENDING. */
const lockedState = (overrides: Record<string, unknown> = {}) => ({
  cancelledAt: null,
  depositSettledAt: null,
  depositReceivedAt: null,
  depositWaivedAt: null,
  depositWaivedReason: null,
  serviceDetails: [
    { isRental: true, quantity: 5, securityDeposit: dec("40"), replacementPrice: dec("120") },
    { isRental: false, quantity: 2, securityDeposit: null, replacementPrice: null },
  ],
  ...overrides,
});

/** The order re-read after the write, in the rich include's shape (now WAIVED). */
const richOrder = () => ({
  id: 12,
  userId: null,
  clientRegistryId: 3,
  deliveryNameKms: encryptKms("María López"),
  deliveryContactKms: encryptKms("5555-1234"),
  deliveryAddressKms: encryptKms("Zona 10"),
  deliveryCoordsKms: null,
  deliveryInstructionsKms: null,
  description: null,
  eventTypeId: 1,
  deliveryAt: DELIVERED,
  pickupAt: new Date("2026-08-02T10:00:00.000Z"),
  deliveredAt: DELIVERED,
  collectedAt: null,
  readyAt: null,
  serviceStart: DELIVERED,
  serviceEnd: new Date("2026-08-02T10:00:00.000Z"),
  assignedUserId: 1,
  totalAmount: dec("300.00"),
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
  depositWaivedAt: DELIVERED,
  depositWaivedReason: "Un familiar",
  currencyId: 1,
  serviceStatusId: 3,
  paymentStatusId: 1,
  paymentMethodId: null,
  comment: null,
  invoiceNumberKms: null,
  isActive: true,
  updatedAt: null,
  createdAt: DELIVERED,
  eventType: { id: 1, name: "Evento familiar" },
  serviceStatus: { id: 3, name: "Entregado" },
  paymentStatus: { id: 1, name: "Pendiente" },
  paymentMethod: null,
  currency: { id: 1, iso4217Code: "GTQ", name: "Quetzal", symbol: "Q" },
  assignedUser: { id: 1, fullNameKms: encryptKms("Romeo") },
  serviceDetails: [
    {
      id: 31,
      productId: 3,
      quantity: 5,
      isRental: true,
      unitaryPrice: dec("60"),
      parcialPrice: dec("300"),
      securityDeposit: dec("40"),
      replacementPrice: dec("120"),
      damagedQuantity: 0,
      damageNote: null,
      product: { name: "Silla plegable" },
    },
  ],
  serviceExtras: [],
  statusHistory: [],
  depositHistory: [],
  evidences: [],
});

function mockTx(state: Record<string, unknown> | null) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(state === null ? [] : [{ id: 12 }]),
    service: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValueOnce(state)
        .mockResolvedValue(richOrder()),
      update: vi.fn().mockResolvedValue({}),
    },
    serviceDepositHistory: { create: vi.fn().mockResolvedValue({}) },
  };
  (getPrismaClient as Mock).mockResolvedValue({
    $transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
  });
  return tx;
}

const req = (body: DepositCollectionRequestModel | undefined = undefined, user: unknown = { userId: 1, userRole: 2 }) =>
  ({ body, params: { id: "12" }, user, ip: "127.0.0.1" }) as unknown as CustomRequest;

const record = (body: DepositCollectionRequestModel, user?: unknown) =>
  recordDepositCollection(req(body, user ?? { userId: 1, userRole: 2 }), {} as Response);

describe("recordDepositCollection", () => {
  it("waives the deposit with its reason, leaves a WAIVED row and answers the order", async () => {
    (isDeployedEnvironment as Mock).mockReturnValueOnce(true);
    const tx = mockTx(lockedState());
    await record({ received: false, reason: "Un familiar" });

    expect(tx.$queryRaw).toHaveBeenCalled(); // FOR UPDATE
    expect(tx.service.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { depositReceivedAt: null, depositWaivedAt: expect.any(Date), depositWaivedReason: "Un familiar" },
    });
    expect(tx.serviceDepositHistory.create).toHaveBeenCalledWith({
      data: { serviceId: 12, kind: "WAIVED", note: "Un familiar", depositTotal: 200, byUserId: 1 },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { operation: "ORDER_DEPOSIT_COLLECTION_RECORDED" } }),
    );
    // The projection reflects the waive: the deposit counts 0.
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "orders.depositCollection.recorded",
      expect.objectContaining({
        order: expect.objectContaining({
          securityDeposit: expect.objectContaining({
            total: 200,
            held: 0,
            collection: expect.objectContaining({ status: "WAIVED", reason: "Un familiar" }),
          }),
        }),
      }),
    );
  });

  it("receives it, clearing a previous waive", async () => {
    const tx = mockTx(lockedState({ depositWaivedAt: DELIVERED, depositWaivedReason: "x" }));
    await record({ received: true, reason: undefined });
    expect(tx.service.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { depositReceivedAt: expect.any(Date), depositWaivedAt: null, depositWaivedReason: null },
    });
    expect(tx.serviceDepositHistory.create).toHaveBeenCalledWith({
      data: { serviceId: 12, kind: "RECEIVED", note: null, depositTotal: 200, byUserId: 1 },
    });
  });

  it("re-sending the same answer keeps the original timestamp and appends nothing", async () => {
    const tx = mockTx(lockedState({ depositReceivedAt: DELIVERED }));
    await record({ received: true, reason: undefined });
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(tx.serviceDepositHistory.create).not.toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalled();
  });

  it("attributes the row to user 0 when the request somehow carries no user", async () => {
    const tx = mockTx(lockedState());
    await recordDepositCollection(
      { body: { received: true, reason: undefined }, params: { id: "12" } } as unknown as CustomRequest,
      {} as Response,
    );
    expect(tx.serviceDepositHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ byUserId: 0 }),
    });
  });

  it("404s a missing order", async () => {
    mockTx(null);
    await record({ received: true, reason: undefined });
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.depositCollection.notFound",
    );
  });

  it.each([
    ["a cancelled order", lockedState({ cancelledAt: DELIVERED }), "notApplicable"],
    [
      "an order with no deposit",
      lockedState({
        serviceDetails: [{ isRental: true, quantity: 5, securityDeposit: null, replacementPrice: dec("120") }],
      }),
      "notApplicable",
    ],
    ["an order with a damage report", lockedState({ depositSettledAt: DELIVERED }), "settled"],
  ])("409s %s", async (_label, state, key) => {
    const tx = mockTx(state);
    await record({ received: true, reason: undefined });
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(tx.serviceDepositHistory.create).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      `orders.depositCollection.${key}`,
    );
  });

  it("500s when the transaction fails", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await record({ received: true, reason: undefined });
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.depositCollection.errorRecording",
    );
  });
});

describe("clearDepositCollection", () => {
  const clear = (request: CustomRequest = req()) => clearDepositCollection(request, {} as Response);

  it("returns it to PENDING with a COLLECTION_CLEARED row", async () => {
    (isDeployedEnvironment as Mock).mockReturnValueOnce(true);
    const tx = mockTx(lockedState({ depositReceivedAt: DELIVERED }));
    await clear();
    expect(tx.service.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { depositReceivedAt: null, depositWaivedAt: null, depositWaivedReason: null },
    });
    expect(tx.serviceDepositHistory.create).toHaveBeenCalledWith({
      data: { serviceId: 12, kind: "COLLECTION_CLEARED", depositTotal: 200, byUserId: 1 },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { operation: "ORDER_DEPOSIT_COLLECTION_CLEARED" } }),
    );
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "orders.depositCollection.cleared",
      expect.anything(),
    );
  });

  it("attributes the row to user 0 when the request somehow carries no user", async () => {
    const tx = mockTx(lockedState({ depositWaivedAt: DELIVERED, depositWaivedReason: "x" }));
    await clear({ params: { id: "12" } } as unknown as CustomRequest);
    expect(tx.serviceDepositHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "COLLECTION_CLEARED", byUserId: 0 }),
    });
  });

  it.each([
    ["nothing is recorded", lockedState(), "notRecorded"],
    ["a damage report exists", lockedState({ depositReceivedAt: DELIVERED, depositSettledAt: DELIVERED }), "settled"],
    ["the order is cancelled", lockedState({ depositReceivedAt: DELIVERED, cancelledAt: DELIVERED }), "notApplicable"],
  ])("409s when %s", async (_label, state, key) => {
    const tx = mockTx(state);
    await clear();
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      `orders.depositCollection.${key}`,
    );
  });

  it("404s a missing order and 500s a failure", async () => {
    mockTx(null);
    await clear();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.depositCollection.notFound",
    );

    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await clear();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.depositCollection.errorClearing",
    );
  });
});
