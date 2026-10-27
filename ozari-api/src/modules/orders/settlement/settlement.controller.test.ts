import { describe, it, expect, vi, beforeAll, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { settleOrder, undoOrderSettlement } from "./settlement.controller.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { encryptKms } from "@helpers/encryption.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import type { SettleOrderRequestModel } from "../orders.models.js";
import {
  DEFAULT_EVIDENCE_BOUNDS,
  SEEDED_STATUS_CATALOG,
} from "@/tests/fixtures/lifecycleCatalog.js";

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

/** The locked state the settle reads: 5 chairs with a Q40 deposit + Q120 replacement, 2 cups sold. */
const lockedState = (overrides: Record<string, unknown> = {}) => ({
  deliveredAt: DELIVERED,
  cancelledAt: null,
  depositSettledAt: null,
  serviceDetails: [
    { id: 31, isRental: true, quantity: 5, securityDeposit: dec("40"), replacementPrice: dec("120"), damagedQuantity: 0 },
    { id: 32, isRental: false, quantity: 2, securityDeposit: null, replacementPrice: null, damagedQuantity: 0 },
    { id: 33, isRental: true, quantity: 1, securityDeposit: null, replacementPrice: null, damagedQuantity: 1 },
  ],
  ...overrides,
});

/** The order re-read after the write, in the rich include's shape. */
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
  depositSettledAt: DELIVERED,
  depositRetainedAmount: dec("50"),
  depositRetainedReason: "Manchas",
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
      damagedQuantity: 2,
      damageNote: "Patas rotas",
      product: { name: "Silla plegable" },
    },
  ],
  serviceExtras: [],
  statusHistory: [],
  evidences: [],
});

function mockTx(state: Record<string, unknown> | null, settledAt: Date | null = null) {
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValue(state === null ? [] : [{ id: 12, deposit_settled_at: settledAt }]),
    service: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValueOnce(state)
        .mockResolvedValue(richOrder()),
      update: vi.fn().mockResolvedValue({}),
    },
    serviceDetail: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  (getPrismaClient as Mock).mockResolvedValue({
    $transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
  });
  return tx;
}

const req = (body: SettleOrderRequestModel | undefined = undefined, id = "12") =>
  ({ body, params: { id }, user: { userId: 1, userRole: 2 }, ip: "127.0.0.1" }) as unknown as CustomRequest;

const settle = (body: SettleOrderRequestModel) => settleOrder(req(body), {} as Response);

describe("settleOrder", () => {
  it("records the settlement: damages per line (clearing a stale one), retention, first-settled stamp", async () => {
    (isDeployedEnvironment as Mock).mockReturnValueOnce(true);
    const tx = mockTx(lockedState());
    await settle({
      retainedAmount: 50,
      retainedReason: "Manchas",
      damages: [{ lineId: 31, quantity: 2, note: "Patas rotas" }],
    });

    expect(tx.serviceDetail.update).toHaveBeenCalledTimes(2);
    expect(tx.serviceDetail.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: { damagedQuantity: 2, damageNote: "Patas rotas" },
    });
    // Line 33 was damaged before and is absent now: declaratively, its damage goes.
    expect(tx.serviceDetail.update).toHaveBeenCalledWith({
      where: { id: 33 },
      data: { damagedQuantity: 0, damageNote: null },
    });
    const write = (tx.service.update as Mock).mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(write.data["depositSettledAt"]).toBeInstanceOf(Date);
    expect(write.data).toMatchObject({ depositRetainedAmount: 50, depositRetainedReason: "Manchas" });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { operation: "ORDER_DEPOSIT_SETTLED" } }),
    );
    // The response carries the derived money: 5 × Q40 = Q200; claims 50 + 240 ⇒ Q90 owed.
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "orders.settlement.settled",
      expect.objectContaining({
        order: expect.objectContaining({
          securityDeposit: expect.objectContaining({
            total: 200,
            settlement: expect.objectContaining({ refundAmount: 0, balanceDue: 90 }),
          }),
        }),
      }),
    );
  });

  it("keeps the FIRST settled moment when a settlement is corrected", async () => {
    const firstSettled = new Date("2026-08-03T09:00:00.000Z");
    const tx = mockTx(lockedState({ depositSettledAt: firstSettled }));
    await settle({ retainedAmount: 0, retainedReason: undefined, damages: [] });

    expect(tx.service.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { depositSettledAt: firstSettled, depositRetainedAmount: 0, depositRetainedReason: null },
    });
  });

  it("404s a missing order", async () => {
    const tx = mockTx(null);
    await settle({ retainedAmount: 0, retainedReason: undefined, damages: [] });
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.settlement.notFound",
    );
  });

  it.each([
    ["not delivered yet", lockedState({ deliveredAt: null })],
    ["cancelled", lockedState({ cancelledAt: DELIVERED })],
    [
      "without a line that can carry a deposit or damage",
      lockedState({ serviceDetails: [lockedState().serviceDetails[1]] }),
    ],
  ])("409s an order %s", async (_label, state) => {
    const tx = mockTx(state);
    await settle({ retainedAmount: 0, retainedReason: undefined, damages: [] });
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.settlement.notSettleable",
    );
  });

  it.each([
    ["an unknown line", { lineId: 99, quantity: 1, note: undefined }],
    ["a sale line", { lineId: 32, quantity: 1, note: undefined }],
    ["a line without a replacement value", { lineId: 33, quantity: 1, note: undefined }],
    ["more units than the line has", { lineId: 31, quantity: 6, note: undefined }],
  ])("400s a damage on %s", async (_label, damage) => {
    const tx = mockTx(lockedState());
    await settle({ retainedAmount: 0, retainedReason: undefined, damages: [damage] });
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.BAD_REQUEST,
      "orders.settlement.invalidDamage",
    );
  });

  it("400s a retention above the deposit", async () => {
    const tx = mockTx(lockedState());
    await settle({ retainedAmount: 200.01, retainedReason: "Todo", damages: [] });
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.BAD_REQUEST,
      "orders.settlement.retainedAboveDeposit",
    );
  });

  it("500s when the transaction fails", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await settle({ retainedAmount: 0, retainedReason: undefined, damages: [] });
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.settlement.errorSettling",
    );
  });
});

describe("undoOrderSettlement", () => {
  const undo = () => undoOrderSettlement(req(), {} as Response);

  it("clears the retention and every line's damage, leaving the deposit unsettled", async () => {
    (isDeployedEnvironment as Mock).mockReturnValueOnce(true);
    const tx = mockTx({}, DELIVERED);
    // The undo never reads the locked state through findUniqueOrThrow — only the re-read.
    tx.service.findUniqueOrThrow.mockReset().mockResolvedValue(richOrder());
    await undo();

    expect(tx.serviceDetail.updateMany).toHaveBeenCalledWith({
      where: { serviceId: 12, damagedQuantity: { gt: 0 } },
      data: { damagedQuantity: 0, damageNote: null },
    });
    expect(tx.service.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { depositSettledAt: null, depositRetainedAmount: null, depositRetainedReason: null },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { operation: "ORDER_DEPOSIT_SETTLEMENT_UNDONE" } }),
    );
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "orders.settlement.undone",
      expect.anything(),
    );
  });

  it("404s a missing order and 409s one with nothing to undo", async () => {
    mockTx(null);
    await undo();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.NOT_FOUND,
      "orders.settlement.notFound",
    );

    const tx = mockTx({}, null);
    await undo();
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "orders.settlement.notSettled",
    );
  });

  it("500s when the transaction fails", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await undo();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.settlement.errorUndoing",
    );
  });
});
