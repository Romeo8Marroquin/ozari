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
      quantity: 25,
      isRental: true,
      unitaryPrice: new Prisma.Decimal("6.00"),
      parcialPrice: new Prisma.Decimal("150.00"),
      product: { name: "Silla plegable" },
    },
  ],
  serviceExtras: [],
  statusHistory: [],
  ...overrides,
});

function mockTx(order: ReturnType<typeof rawOrder> | null = rawOrder()) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    service: {
      findFirst: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi.fn().mockResolvedValue(rawOrder()),
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
    body: { evidenceKeys: [], reason: undefined, ...body },
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
      buildReq({ toStatusId: 3, evidenceKeys: [KEY] }),
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

  it("a move nobody could make from here is a 409, not a 403", async () => {
    // Pendiente → Entregado skips En ruta: illegal for every actor (a stale client).
    const tx = mockTx();
    await advanceOrder(buildReq({ toStatusId: 3 }), {} as Response);

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
