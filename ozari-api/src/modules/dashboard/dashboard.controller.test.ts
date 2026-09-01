import { describe, it, expect, vi, beforeAll, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { getDashboard } from "./dashboard.controller.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { encryptKms } from "@helpers/encryption.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import {
  DEFAULT_EVIDENCE_BOUNDS,
  SEEDED_STATUS_CATALOG,
} from "@/tests/fixtures/lifecycleCatalog.js";
import type { DashboardEnvelopeModel } from "./dashboard.models.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariSuccessModel.js", () => ({ sendOzariSuccess: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));
// Only the lifecycle machine's two DB readers are stubbed — every projection below runs the real
// engine against the SEEDED catalog, so `actions` here is what the agenda would show.
vi.mock("../orders/lifecycle/lifecycle.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../orders/lifecycle/lifecycle.service.js")>()),
  getStatusCatalog: vi.fn(async () => SEEDED_STATUS_CATALOG),
  getEvidenceBounds: vi.fn(async () => DEFAULT_EVIDENCE_BOUNDS),
}));

const VALID_ENCRYPTION_KEY =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] = VALID_ENCRYPTION_KEY;
});

const CURRENCY = { id: 1, iso4217Code: "GTQ", name: "Quetzal", symbol: "Q" };

/** A raw order row as the dashboard include fetches it. */
const rawOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  userId: null,
  clientRegistryId: 3,
  deliveryNameKms: encryptKms("María López"),
  deliveryContactKms: encryptKms("5555-1234"),
  deliveryAddressKms: encryptKms("Zona 10, 4a avenida 5-55"),
  deliveryCoordsKms: null,
  deliveryInstructionsKms: null,
  eventTypeId: 1,
  deliveryAt: new Date("2026-08-01T14:00:00.000Z"),
  pickupAt: new Date("2026-08-02T10:00:00.000Z"),
  deliveredAt: null,
  collectedAt: null,
  readyAt: null,
  assignedUserId: 1,
  totalAmount: new Prisma.Decimal("450.00"),
  depositAmount: null,
  paidAt: null,
  cancelledAt: null,
  currencyId: 1,
  serviceStatusId: 1,
  paymentStatusId: 1,
  isActive: true,
  eventType: { id: 1, name: "Evento familiar" },
  serviceStatus: { id: 1, name: "Pendiente" },
  paymentStatus: { id: 1, name: "Pendiente" },
  currency: CURRENCY,
  assignedUser: null,
  serviceDetails: [{ quantity: 2, isRental: true }],
  ...overrides,
});

interface DashboardMocks {
  deliveries?: unknown[];
  collections?: unknown[];
  counts?: number[];
  trendRows?: unknown[];
  unpaidRows?: unknown[];
  topProducts?: unknown[];
  statusRows?: unknown[];
  latestCurrency?: unknown;
  systemCurrency?: unknown;
}

/** Wires the prisma client so the controller's ONE `Promise.all` resolves deterministically. */
const mockPrisma = (mocks: DashboardMocks = {}) => {
  // In `Promise.all` order: deliveries today, collections today, overdue deliveries, overdue
  // collections, active, cancelled this month, cancelled last month.
  const counts = mocks.counts ?? [4, 2, 1, 0, 9, 3, 5];
  const count = vi.fn();
  counts.forEach((value) => count.mockResolvedValueOnce(value));
  const findMany = vi
    .fn()
    // Order matters: it mirrors the Promise.all — pending deliveries, pending collections, trend,
    // unpaid.
    .mockResolvedValueOnce(mocks.deliveries ?? [])
    .mockResolvedValueOnce(mocks.collections ?? [])
    .mockResolvedValueOnce(mocks.trendRows ?? [])
    .mockResolvedValueOnce(mocks.unpaidRows ?? []);
  const client = {
    service: {
      findMany,
      count,
      // In `Promise.all` order: this month's revenue, last month's, this month's CASH IN, last
      // month's. The last two are scoped by `paidAt`, so they deliberately do not equal the first
      // two — an order delivered in one month and settled in the next belongs to both figures.
      aggregate: vi
        .fn()
        .mockResolvedValueOnce({
          _sum: { totalAmount: new Prisma.Decimal("12400") },
          _count: { _all: 28 },
        })
        .mockResolvedValueOnce({
          _sum: { totalAmount: new Prisma.Decimal("9800") },
          _count: { _all: 24 },
        })
        .mockResolvedValueOnce({ _sum: { totalAmount: new Prisma.Decimal("10500") } })
        .mockResolvedValueOnce({ _sum: { totalAmount: new Prisma.Decimal("8400") } }),
      groupBy: vi.fn(async () => mocks.statusRows ?? []),
      findFirst: vi.fn(async () =>
        "latestCurrency" in mocks ? mocks.latestCurrency : { currency: CURRENCY },
      ),
    },
    serviceDetail: { groupBy: vi.fn(async () => mocks.topProducts ?? []) },
    product: { findMany: vi.fn(async () => [{ id: 3, name: "Silla Tiffany" }]) },
    // `in`, not `??`: a test that deliberately passes `null` here is asserting "no currency exists",
    // and `??` treats null as nullish and would hand back the default instead.
    currency: {
      findFirst: vi.fn(async () =>
        "systemCurrency" in mocks ? mocks.systemCurrency : CURRENCY,
      ),
    },
  };
  (getPrismaClient as Mock).mockResolvedValue(client);
  return client;
};

const req = { user: { userId: 1, userRole: RolesEnum.Admin } } as unknown as CustomRequest;
const res = {} as Response;

const sentDashboard = (): DashboardEnvelopeModel["dashboard"] =>
  ((sendOzariSuccess as Mock).mock.calls[0][3] as DashboardEnvelopeModel).dashboard;

beforeEach(() => vi.clearAllMocks());

describe("getDashboard", () => {
  it("answers the whole screen in one payload, from a single instant", async () => {
    mockPrisma();
    await getDashboard(req, res);

    expect(sendOzariSuccess).toHaveBeenCalledWith(
      res,
      HttpEnum.OK,
      expect.any(String),
      expect.any(Object),
    );
    const dashboard = sentDashboard();
    expect(dashboard.generatedAt).toBeInstanceOf(Date);
    expect(dashboard.today).toEqual({ deliveries: 4, collections: 2, overdue: 1, active: 9 });
    expect(dashboard.currency).toEqual(CURRENCY);
  });

  it("merges the two indexed queries into ONE queue ordered by the next event", async () => {
    // A pending DELIVERY at 14:00 and, on a different order, a pending COLLECTION at 09:00. The
    // collection is sooner, so it must lead — which is the whole reason the two sets are merged
    // rather than concatenated.
    mockPrisma({
      deliveries: [rawOrder({ id: 12, deliveryAt: new Date("2026-08-01T14:00:00.000Z") })],
      collections: [
        rawOrder({
          id: 8,
          deliveredAt: new Date("2026-07-31T10:00:00.000Z"),
          pickupAt: new Date("2026-08-01T09:00:00.000Z"),
        }),
      ],
    });
    await getDashboard(req, res);

    const { upNext } = sentDashboard();
    expect(upNext.map((item) => [item.id, item.event.kind])).toEqual([
      [8, "COLLECTION"],
      [12, "DELIVERY"],
    ]);
    // Each card carries what a driver needs and the engine's own action list.
    expect(upNext[0]?.deliveryAddress).toBe("Zona 10, 4a avenida 5-55");
    expect(upNext[0]?.actions.length).toBeGreaterThan(0);
  });

  it("compares the month with the previous one and shapes the derived figures", async () => {
    mockPrisma();
    await getDashboard(req, res);

    const { month } = sentDashboard();
    expect(month.revenue).toEqual({ current: 12400, previous: 9800, deltaPercent: 26.5 });
    expect(month.orders).toEqual({ current: 28, previous: 24, deltaPercent: 16.7 });
    expect(month.averageOrder.current).toBe(442.86);
    // CASH IN is its own figure, scoped by `paidAt` rather than by delivery date — so it is
    // deliberately NOT the revenue total. The gap between the two is what `outstanding` tracks.
    expect(month.collected).toEqual({ current: 10500, previous: 8400, deltaPercent: 25 });
    // Cancellations are excluded from revenue and from "in progress" — counted here so the screen
    // reports work LOST as well as work done.
    expect(month.cancelled).toEqual({ current: 3, previous: 5, deltaPercent: -40 });
  });

  it("ranks top products, naming a deleted one by id rather than dropping the row", async () => {
    mockPrisma({
      topProducts: [
        { productId: 3, _sum: { quantity: 240, parcialPrice: new Prisma.Decimal("4800") } },
        { productId: 99, _sum: { quantity: 10, parcialPrice: new Prisma.Decimal("100") } },
      ],
    });
    await getDashboard(req, res);

    expect(sentDashboard().topProducts).toEqual([
      { productId: 3, name: "Silla Tiffany", quantity: 240, revenue: 4800 },
      { productId: 99, name: "#99", quantity: 10, revenue: 100 },
    ]);
  });

  it("handles a groupBy row with no summed quantity as zero", async () => {
    mockPrisma({ topProducts: [{ productId: 3, _sum: { quantity: null, parcialPrice: null } }] });
    await getDashboard(req, res);
    expect(sentDashboard().topProducts[0]).toMatchObject({ quantity: 0, revenue: 0 });
  });

  it("names the status split from the lifecycle catalog, busiest first", async () => {
    mockPrisma({
      statusRows: [
        { serviceStatusId: 3, _count: { _all: 3 } },
        { serviceStatusId: 1, _count: { _all: 6 } },
        { serviceStatusId: 404, _count: { _all: 1 } },
      ],
    });
    await getDashboard(req, res);

    expect(sentDashboard().statusSplit).toEqual([
      { statusId: 1, name: "Pendiente", colorKey: "amber", count: 6 },
      { statusId: 3, name: "Entregado", colorKey: "emerald", count: 3 },
      // A status the catalog no longer publishes still has live orders — name it rather than lose them.
      { statusId: 404, name: "#404", count: 1 },
    ]);
  });

  it("falls back to the seeded currency on a database with no orders yet", async () => {
    mockPrisma({ latestCurrency: null });
    await getDashboard(req, res);
    expect(sentDashboard().currency).toEqual(CURRENCY);
  });

  it("500s when no currency is configured at all, rather than formatting nothing", async () => {
    mockPrisma({ latestCurrency: null, systemCurrency: null });
    await getDashboard(req, res);

    expect(sendOzariSuccess).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      expect.any(String),
    );
  });

  it("500s on an unexpected failure without leaking it", async () => {
    (getPrismaClient as Mock).mockRejectedValue(new Error("db down"));
    await getDashboard(req, res);

    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      expect.any(String),
    );
  });

  it("defaults the actor when the request somehow carries no user", async () => {
    mockPrisma();
    await getDashboard({} as CustomRequest, res);
    expect(sendOzariSuccess).toHaveBeenCalled();
  });
});
