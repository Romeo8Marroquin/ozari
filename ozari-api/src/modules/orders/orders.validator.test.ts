import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, type Mock } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import {
  validateCreateOrder,
  validateOrderAvailability,
  validateUpdateOrder,
} from "./orders.validator.js";
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
    // The assignable-staff check: an active deliverable user by default.
    user: { findFirst: vi.fn().mockResolvedValue({ id: 5 }) },
    ...overrides,
  });
}

// Freeze "now" well before the fixtures' 2026-08 dates so the not-in-past delivery guard is
// deterministic (and the hardcoded future fixtures never become stale as the wall clock advances).
const FROZEN_NOW = new Date("2026-07-15T12:00:00.000Z").getTime();
beforeAll(() => vi.spyOn(Date, "now").mockReturnValue(FROZEN_NOW));
afterAll(() => vi.restoreAllMocks());

const validBody = () => ({
  clientRegistryId: 3,
  eventTypeId: 1,
  deliveryAt: "2026-08-01T14:00:00.000Z",
  pickupAt: "2026-08-02T10:00:00.000Z",
  deliveryName: "María López",
  deliveryContact: "WhatsApp 5555-1234",
  deliveryAddress: "Zona 10, 4a avenida 5-55",
  // Required since the logistics pad became a rule about a DRIVER's day (Q-D2).
  assignedUserId: 5,
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
    ["deliveryInPast", { deliveryAt: "2020-01-01T00:00:00.000Z" }],
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

  it("REJECTS an order with no assignee — every event needs an owner (Q-D2)", async () => {
    // It used to default to the creating admin, which made "unassigned" a state that could not
    // happen but still had to be reasoned about. The logistics pad is a rule about a driver's day,
    // so the ambiguity is deleted here rather than modelled downstream.
    const { assignedUserId, ...withoutAssignee } = validBody();
    expect(assignedUserId).toBe(5);
    await run(withoutAssignee);
    expectRejected("invalidAssignedUserId");
  });

  it("accepts a valid deliverable assignee and puts it on the body", async () => {
    const { req, next } = await run({ ...validBody(), assignedUserId: 5 });
    expect(next).toHaveBeenCalled();
    expect((req.body as Record<string, unknown>)["assignedUserId"]).toBe(5);
  });

  it("rejects an assignee who is not an active deliverable user (Admin/Driver) via the DB", async () => {
    mockPrisma({ user: { findFirst: vi.fn().mockResolvedValue(null) } });
    await run({ ...validBody(), assignedUserId: 99 });
    expectRejected("invalidAssignedUserId");
  });

  it("rejects a malformed assignee id without a DB lookup", async () => {
    await run({ ...validBody(), assignedUserId: "x" });
    expectRejected("invalidAssignedUserId");
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

describe("validateUpdateOrder", () => {
  const runUpdate = async (body: Record<string, unknown>) => {
    const req = { body, params: { id: "12" } } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;
    await validateUpdateOrder(req, {} as Response, next);
    return { req, next };
  };

  it("holds an edit to the SAME contract as create, under its own message namespace", async () => {
    const { next } = await runUpdate({ ...validBody(), deliveryAddress: "abc" });
    expect(next).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.BAD_REQUEST,
      "orders.updateOrder.validators.invalidDeliveryAddress",
    );
  });

  it("lets an edit put the delivery ANYWHERE, including the past", async () => {
    // "Not in the past" is a rule about scheduling something NEW. An order being corrected already
    // happened — or is being moved for a reason the admin knows and the system doesn't.
    const { req, next } = await runUpdate({
      ...validBody(),
      deliveryAt: "2026-07-01T14:00:00.000Z",
      pickupAt: "2026-07-02T10:00:00.000Z",
    });
    expect(next).toHaveBeenCalled();
    expect((req.body as Record<string, unknown>)["deliveryAt"]).toBeInstanceOf(Date);
  });

  it("still keeps the pickup after the delivery, whatever the dates are", async () => {
    const { next } = await runUpdate({
      ...validBody(),
      deliveryAt: "2026-07-02T10:00:00.000Z",
      pickupAt: "2026-07-01T14:00:00.000Z",
    });
    expect(next).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.BAD_REQUEST,
      "orders.updateOrder.validators.pickupBeforeDelivery",
    );
  });

  it("responds 500 under its own key when a lookup blows up", async () => {
    mockPrisma({ clientRegistry: { findFirst: vi.fn().mockRejectedValue(new Error("db down")) } });
    await runUpdate(validBody());
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.updateOrder.validators.validationError",
    );
  });
});

const runAvailability = (body: unknown): { req: Request; next: Mock } => {
  const req = { body } as unknown as Request;
  const next = vi.fn();
  validateOrderAvailability(req, {} as Response, next as unknown as NextFunction);
  return { req, next };
};
const expectRejectedAvailability = (key: string): void => {
  expect(sendOzariError).toHaveBeenCalledWith(
    expect.anything(),
    HttpEnum.BAD_REQUEST,
    `orders.availability.validators.${key}`,
  );
};

describe("validateOrderAvailability", () => {
  const DELIVERY = "2026-08-01T14:00:00.000Z";
  const PICKUP = "2026-08-02T10:00:00.000Z";

  it("passes a valid probe with delivery + pickup + product ids", () => {
    const { req, next } = runAvailability({ deliveryAt: DELIVERY, pickupAt: PICKUP, productIds: [3, 4] });
    expect(next).toHaveBeenCalled();
    const body = req.body as Record<string, unknown>;
    expect(body["deliveryAt"]).toBeInstanceOf(Date);
    expect(body["pickupAt"]).toBeInstanceOf(Date);
    expect(body["productIds"]).toEqual([3, 4]);
    // The driver half is optional: with no assignee, the probe answers about goods only.
    expect(body["assignedUserId"]).toBeUndefined();
    expect(body["excludeOrderId"]).toBeUndefined();
  });

  it("carries the driver half through: the assignee and the order an edit excludes", () => {
    const { req, next } = runAvailability({
      deliveryAt: DELIVERY,
      pickupAt: PICKUP,
      productIds: [3],
      assignedUserId: 2,
      excludeOrderId: 12,
    });
    expect(next).toHaveBeenCalled();
    const body = req.body as Record<string, unknown>;
    expect(body["assignedUserId"]).toBe(2);
    expect(body["excludeOrderId"]).toBe(12);
  });

  it("reads a null assignee as 'not chosen yet', not as an error", () => {
    // A select cleared back to its placeholder sends `null`; that is a form state, not a bad id.
    const { req, next } = runAvailability({
      deliveryAt: DELIVERY,
      productIds: [3],
      assignedUserId: null,
    });
    expect(next).toHaveBeenCalled();
    expect((req.body as Record<string, unknown>)["assignedUserId"]).toBeUndefined();
  });

  it("treats an absent/empty/null pickup as 'no rental window yet'", () => {
    for (const pickupAt of [undefined, null, ""]) {
      vi.clearAllMocks();
      const { req, next } = runAvailability({ deliveryAt: DELIVERY, ...(pickupAt !== undefined && { pickupAt }), productIds: [3] });
      expect(next).toHaveBeenCalled();
      expect((req.body as Record<string, unknown>)["pickupAt"]).toBeUndefined();
    }
  });

  it.each([
    ["invalidDeliveryAt", { deliveryAt: "nope", productIds: [3] }],
    ["invalidPickupAt", { deliveryAt: DELIVERY, pickupAt: "nope", productIds: [3] }],
    ["pickupBeforeDelivery", { deliveryAt: DELIVERY, pickupAt: "2026-08-01T13:00:00.000Z", productIds: [3] }],
    ["invalidProductIds", { deliveryAt: DELIVERY, productIds: [] }],
    ["invalidProductIds", { deliveryAt: DELIVERY, productIds: "x" }],
    ["invalidProductIds", { deliveryAt: DELIVERY, productIds: [0] }],
    ["invalidAssignedUserId", { deliveryAt: DELIVERY, productIds: [3], assignedUserId: "x" }],
    ["invalidExcludeOrderId", { deliveryAt: DELIVERY, productIds: [3], excludeOrderId: 0 }],
  ])("rejects %s", (key, body) => {
    const { next } = runAvailability(body);
    expect(next).not.toHaveBeenCalled();
    expectRejectedAvailability(key);
  });

  it("rejects too many product ids", () => {
    runAvailability({ deliveryAt: DELIVERY, productIds: Array.from({ length: 201 }, (_, i) => i + 1) });
    expectRejectedAvailability("tooManyProductIds");
  });

  it("responds 500 on a malformed body", () => {
    validateOrderAvailability({ body: null } as unknown as Request, {} as Response, vi.fn() as unknown as NextFunction);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.availability.validators.validationError",
    );
  });
});
