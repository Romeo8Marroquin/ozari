import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  validatePayOrder,
  validateUndoOrderPayment,
} from "./payment.validator.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

vi.mock("@/config/logger.js", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

const run = (params: Record<string, string>, body: unknown) => {
  const req = { params, body } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  validatePayOrder(req, {} as Response, next);
  return { req, next };
};

beforeEach(() => vi.clearAllMocks());

describe("validatePayOrder", () => {
  it("accepts an empty body — cash at the door often has no method recorded", () => {
    const { req, next } = run({ id: "12" }, {});
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({});
  });

  it("accepts a method id and narrows the body to it", () => {
    const { req, next } = run({ id: "12" }, { paymentMethodId: 2, sneaky: "x" });
    expect(next).toHaveBeenCalled();
    // Narrowed: an unexpected field can never reach the write.
    expect(req.body).toEqual({ paymentMethodId: 2 });
  });

  it("treats an explicit null method as absent rather than as a value", () => {
    const { req, next } = run({ id: "12" }, { paymentMethodId: null });
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({});
  });

  it("tolerates a missing body entirely", () => {
    const { req, next } = run({ id: "12" }, undefined);
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({});
  });

  it.each([["abc"], ["0"], ["-3"], ["1.5"]])(
    "rejects a malformed id (%s) as a 400 about the request, not a NaN in a query",
    (id) => {
      const { next } = run({ id }, {});
      expect(next).not.toHaveBeenCalled();
      expect(sendOzariError).toHaveBeenCalledWith(
        {},
        HttpEnum.BAD_REQUEST,
        "orders.payOrder.validators.invalidId",
      );
    },
  );

  it.each([[0], [-1], [2.5], ["2"], [{}]])("rejects a malformed method (%s)", (method) => {
    const { next } = run({ id: "12" }, { paymentMethodId: method });
    expect(next).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      {},
      HttpEnum.BAD_REQUEST,
      "orders.payOrder.validators.invalidMethod",
    );
  });
});

describe("validateUndoOrderPayment", () => {
  const undo = (params: Record<string, string>, body: unknown = {}) => {
    const req = { params, body } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;
    validateUndoOrderPayment(req, {} as Response, next);
    return { req, next };
  };

  it("passes a well-formed id straight through — the act carries no options at all", () => {
    // Undoing is a CORRECTION of a mistaken tap, not a refund: there is no amount, date or method
    // to supply, so a body is meaningless here rather than malformed.
    const { next } = undo({ id: "12" });
    expect(next).toHaveBeenCalled();
  });

  it("ignores whatever a stale client sends in the body", () => {
    const { next } = undo({ id: "12" }, { paymentMethodId: 3 });
    expect(next).toHaveBeenCalled();
  });

  it.each([["abc"], ["0"], ["-3"], ["1.5"]])("rejects a malformed id (%s)", (id) => {
    const { next } = undo({ id });
    expect(next).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      {},
      HttpEnum.BAD_REQUEST,
      "orders.payOrder.validators.invalidId",
    );
  });
});
