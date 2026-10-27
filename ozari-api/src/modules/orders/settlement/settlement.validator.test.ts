import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  SETTLEMENT_TEXT_MAX_LENGTH,
  validateSettleOrder,
  validateUndoSettlement,
} from "./settlement.validator.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

vi.mock("@/config/logger.js", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));
vi.mock("@/config/app.js", () => ({
  appConfig: { maxGlobalAmount: 1000000, maxGlobalQuantity: 1000, maxOrderLines: 3 },
}));

const run = (body: unknown, params: Record<string, string> = { id: "12" }) => {
  const req = { params, body } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  validateSettleOrder(req, {} as Response, next);
  return { req, next };
};

const expectRejected = (next: NextFunction, key: string) => {
  expect(next).not.toHaveBeenCalled();
  expect(sendOzariError).toHaveBeenCalledWith(
    {},
    HttpEnum.BAD_REQUEST,
    `orders.settlement.validators.${key}`,
  );
};

beforeEach(() => vi.clearAllMocks());

describe("validateSettleOrder", () => {
  it("accepts the happy path — the whole deposit back, no damage — and narrows the body", () => {
    const { req, next } = run({ retainedAmount: 0, retainedReason: "ignorado", sneaky: true });
    expect(next).toHaveBeenCalled();
    // Nothing retained ⇒ no reason is kept, whatever was typed.
    expect(req.body).toEqual({ retainedAmount: 0, retainedReason: undefined, damages: [] });
  });

  it("accepts a retention with its reason and damages with optional notes, sanitized", () => {
    const { req, next } = run({
      retainedAmount: 150.459,
      retainedReason: "  Manchas de vino en 3 manteles  ",
      damages: [
        { lineId: 31, quantity: 2, note: "  Patas rotas " },
        { lineId: 32, quantity: 1, note: "   " },
        { lineId: 33, quantity: 1, note: null },
      ],
    });
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({
      retainedAmount: 150.45,
      retainedReason: "Manchas de vino en 3 manteles",
      damages: [
        { lineId: 31, quantity: 2, note: "Patas rotas" },
        { lineId: 32, quantity: 1, note: undefined },
        { lineId: 33, quantity: 1, note: undefined },
      ],
    });
  });

  it.each([["abc"], ["0"], ["-3"], ["1.5"]])("rejects a malformed id (%s)", (id) => {
    const { next } = run({ retainedAmount: 0 }, { id });
    expectRejected(next, "invalidId");
  });

  it.each([[undefined], [-1], [Number.NaN], ["100"], [1000001]])(
    "rejects a malformed retained amount (%s)",
    (retainedAmount) => {
      const { next } = run({ retainedAmount });
      expectRejected(next, "invalidRetainedAmount");
    },
  );

  it("rejects a missing body as a missing retained amount", () => {
    const { next } = run(undefined);
    expectRejected(next, "invalidRetainedAmount");
  });

  it.each([[42], ["x".repeat(SETTLEMENT_TEXT_MAX_LENGTH + 1)]])(
    "rejects an unusable reason",
    (retainedReason) => {
      const { next } = run({ retainedAmount: 10, retainedReason });
      expectRejected(next, "invalidRetainedReason");
    },
  );

  it.each([[undefined], ["   "]])("requires a reason whenever money is retained (%s)", (retainedReason) => {
    const { next } = run({ retainedAmount: 10, retainedReason });
    expectRejected(next, "retainedReasonRequired");
  });

  it.each([
    ["not a list", "x"],
    ["too many entries", [1, 2, 3, 4].map((lineId) => ({ lineId, quantity: 1 }))],
    ["a null entry", [null]],
    ["a bad line id", [{ lineId: 0, quantity: 1 }]],
    ["a non-integer line id", [{ lineId: "31", quantity: 1 }]],
    ["a repeated line", [{ lineId: 31, quantity: 1 }, { lineId: 31, quantity: 2 }]],
    ["a zero quantity", [{ lineId: 31, quantity: 0 }]],
    ["a fractional quantity", [{ lineId: 31, quantity: 1.5 }]],
    ["an absurd quantity", [{ lineId: 31, quantity: 1001 }]],
    ["an unusable note", [{ lineId: 31, quantity: 1, note: 7 }]],
  ])("rejects damages with %s", (_label, damages) => {
    const { next } = run({ retainedAmount: 0, damages });
    expectRejected(next, "invalidDamages");
  });

  it("treats an explicit null damage list as none", () => {
    const { req, next } = run({ retainedAmount: 0, damages: null });
    expect(next).toHaveBeenCalled();
    expect((req.body as { damages: unknown[] }).damages).toEqual([]);
  });
});

describe("validateUndoSettlement", () => {
  const undo = (params: Record<string, string>) => {
    const next = vi.fn() as unknown as NextFunction;
    validateUndoSettlement({ params, body: {} } as unknown as Request, {} as Response, next);
    return next;
  };

  it("passes a well-formed id straight through — the act carries no options", () => {
    expect(undo({ id: "12" })).toHaveBeenCalled();
  });

  it.each([["abc"], ["0"]])("rejects a malformed id (%s)", (id) => {
    expectRejected(undo({ id }), "invalidId");
  });
});
