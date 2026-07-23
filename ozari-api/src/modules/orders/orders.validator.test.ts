import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { validateCreateOrder } from "./orders.validator.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { appConfig } from "@/config/app.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

/** An active rental (Día) and an active sale product, as the validator's select shapes them. */
const rentalProduct = {
  id: 3,
  currencyId: 1,
  productBusinessTypeId: 1,
  rentTimeUnitId: 2,
  rentPrice: new Prisma.Decimal("6.00"),
  sellPrice: null,
};
const saleProduct = {
  id: 4,
  currencyId: 1,
  productBusinessTypeId: 2,
  rentTimeUnitId: null,
  rentPrice: null,
  sellPrice: new Prisma.Decimal("3.50"),
};

function mockPrisma(overrides: Record<string, unknown> = {}) {
  (getPrismaClient as Mock).mockResolvedValue({
    clientRegistry: { findFirst: vi.fn().mockResolvedValue({ id: 3 }) },
    eventType: { findFirst: vi.fn().mockResolvedValue({ id: 1 }) },
    paymentMethod: { findFirst: vi.fn().mockResolvedValue({ id: 1 }) },
    product: { findMany: vi.fn().mockResolvedValue([rentalProduct, saleProduct]) },
    ...overrides,
  });
}

const validBody = () => ({
  clientRegistryId: 3,
  eventTypeId: 1,
  deliveryAt: "2026-08-01T14:00:00.000Z",
  pickupAt: "2026-08-02T10:00:00.000Z",
  deliveryName: "María López",
  deliveryContact: "WhatsApp 5555-1234",
  deliveryAddress: "Zona 10, 4a avenida 5-55",
  lines: [
    { productId: 3, quantity: 25 },
    { productId: 4, quantity: 10 },
  ],
});

const run = async (body: Record<string, unknown>) => {
  const req = { body } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  await validateCreateOrder(req, {} as Response, next);
  return { req, next };
};

const expectRejected = (key: string) => {
  expect(sendOzariError).toHaveBeenCalledWith(
    expect.anything(),
    HttpEnum.BAD_REQUEST,
    `orders.createOrder.validators.${key}`,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma();
});

describe("validateCreateOrder", () => {
  it("passes a coherent mixed order through, parsing dates and trimming snapshots", async () => {
    const { req, next } = await run({
      ...validBody(),
      deliveryName: "  María López  ",
      description: "  Mesas y sillas para jardín  ",
      comment: "  Llamar al llegar  ",
    });
    expect(next).toHaveBeenCalled();
    const body = req.body as Record<string, unknown>;
    expect(body["deliveryAt"]).toBeInstanceOf(Date);
    expect(body["pickupAt"]).toBeInstanceOf(Date);
    expect(body["deliveryName"]).toBe("María López");
    expect(body["description"]).toBe("Mesas y sillas para jardín");
    expect(body["comment"]).toBe("Llamar al llegar");
    expect(body["deliveryAmount"]).toBeUndefined();
  });

  it("accepts a purchase-only order WITHOUT a pickup and truncates money to cents", async () => {
    const { req, next } = await run({
      ...validBody(),
      pickupAt: undefined,
      lines: [{ productId: 4, quantity: 10 }],
      deliveryAmount: 50.999,
    });
    expect(next).toHaveBeenCalled();
    const body = req.body as Record<string, unknown>;
    expect(body["pickupAt"]).toBeUndefined();
    expect(body["deliveryAmount"]).toBe(50.99);
  });

  it.each([
    ["invalidClientRegistryId", { clientRegistryId: "x" }],
    ["invalidEventTypeId", { eventTypeId: "x" }],
    ["invalidDeliveryAt", { deliveryAt: "not-a-date" }],
    ["invalidLines", { lines: [] }],
    ["invalidLineQuantity", { lines: [{ productId: 3, quantity: 0 }] }],
    ["duplicateLineProduct", { lines: [{ productId: 3, quantity: 1 }, { productId: 3, quantity: 2 }] }],
    ["invalidLineProduct", { lines: [{ productId: -1, quantity: 1 }] }],
    ["pickupBeforeDelivery", { pickupAt: "2026-08-01T13:00:00.000Z" }],
    ["invalidDeliveryName", { deliveryName: "x" }],
    ["invalidDeliveryContact", { deliveryContact: "" }],
    ["invalidDeliveryAddress", { deliveryAddress: "abc" }],
    ["invalidDescription", { description: 42 }],
    ["invalidComment", { comment: 42 }],
    ["invalidDeliveryAmount", { deliveryAmount: -1 }],
    ["invalidDepositAmount", { depositAmount: "x" }],
    ["invalidPaymentMethodId", { paymentMethodId: "x" }],
  ])("rejects %s", async (key, patch) => {
    const { next } = await run({ ...validBody(), ...patch });
    expect(next).not.toHaveBeenCalled();
    expectRejected(key);
  });

  it("accepts an order with a valid payment method and puts it on the body", async () => {
    const { req, next } = await run({ ...validBody(), paymentMethodId: 1 });
    expect(next).toHaveBeenCalled();
    expect((req.body as Record<string, unknown>)["paymentMethodId"]).toBe(1);
  });

  it("rejects an unknown/inactive payment method via the DB", async () => {
    mockPrisma({ paymentMethod: { findFirst: vi.fn().mockResolvedValue(null) } });
    await run({ ...validBody(), paymentMethodId: 99 });
    expectRejected("invalidPaymentMethodId");
  });

  it("rejects an unknown/inactive registry and event type via the DB", async () => {
    mockPrisma({ clientRegistry: { findFirst: vi.fn().mockResolvedValue(null) } });
    await run(validBody());
    expectRejected("invalidClientRegistryId");

    vi.clearAllMocks();
    mockPrisma({ eventType: { findFirst: vi.fn().mockResolvedValue(null) } });
    await run(validBody());
    expectRejected("invalidEventTypeId");
  });

  it("rejects more lines than the cap", async () => {
    const lines = Array.from({ length: appConfig.maxOrderLines + 1 }, (_, index) => ({
      productId: index + 1,
      quantity: 1,
    }));
    await run({ ...validBody(), lines });
    expectRejected("tooManyLines");
  });

  it("rejects a line whose product does not exist or is inactive", async () => {
    mockPrisma({ product: { findMany: vi.fn().mockResolvedValue([rentalProduct]) } });
    await run(validBody()); // line for product 4 has no active row
    expectRejected("unknownLineProduct");
  });

  it("rejects a rental product whose rent unit the day-based billing engine can't price", async () => {
    mockPrisma({
      product: {
        findMany: vi.fn().mockResolvedValue([{ ...rentalProduct, rentTimeUnitId: 1 }]),
      },
    });
    await run({ ...validBody(), lines: [{ productId: 3, quantity: 1 }] });
    expectRejected("unsupportedRentTimeUnit");
  });

  it("rejects a product violating the conditional price rule (defensive)", async () => {
    mockPrisma({
      product: { findMany: vi.fn().mockResolvedValue([{ ...rentalProduct, rentPrice: null }]) },
    });
    await run({ ...validBody(), lines: [{ productId: 3, quantity: 1 }] });
    expectRejected("unknownLineProduct");
  });

  it("rejects lines that mix currencies", async () => {
    mockPrisma({
      product: {
        findMany: vi.fn().mockResolvedValue([rentalProduct, { ...saleProduct, currencyId: 2 }]),
      },
    });
    await run(validBody());
    expectRejected("mixedCurrencies");
  });

  it("mode coherence: rentals demand a pickup; purchase-only forbids one", async () => {
    await run({ ...validBody(), pickupAt: undefined });
    expectRejected("pickupRequiredForRental");

    vi.clearAllMocks();
    mockPrisma();
    await run({
      ...validBody(),
      lines: [{ productId: 4, quantity: 1 }],
      pickupAt: "2026-08-02T10:00:00.000Z",
    });
    expectRejected("pickupForbiddenForPurchase");
  });

  it("responds 500 when a lookup blows up", async () => {
    mockPrisma({ clientRegistry: { findFirst: vi.fn().mockRejectedValue(new Error("db down")) } });
    await run(validBody());
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.createOrder.validators.validationError",
    );
  });
});
