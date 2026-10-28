import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { SETTLEMENT_TEXT_MAX_LENGTH } from "../settlement/settlement.validator.js";
import {
  parseDepositCollection,
  validateClearDepositCollection,
  validateRecordDepositCollection,
} from "./depositCollection.validator.js";

vi.mock("@/config/logger.js", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

const expectRejected = (next: NextFunction, key: string) => {
  expect(next).not.toHaveBeenCalled();
  expect(sendOzariError).toHaveBeenCalledWith(
    {},
    HttpEnum.BAD_REQUEST,
    `orders.depositCollection.validators.${key}`,
  );
};

describe("parseDepositCollection", () => {
  it("accepts a receipt and DROPS any reason sent with it", () => {
    expect(parseDepositCollection({ received: true, reason: "ignorado" })).toEqual({
      body: { received: true, reason: undefined },
    });
  });

  it("accepts a waive with its reason, trimmed", () => {
    expect(parseDepositCollection({ received: false, reason: "  Un familiar  " })).toEqual({
      body: { received: false, reason: "Un familiar" },
    });
    const longest = "a".repeat(SETTLEMENT_TEXT_MAX_LENGTH);
    expect(parseDepositCollection({ received: false, reason: longest })).toEqual({
      body: { received: false, reason: longest },
    });
  });

  it.each([
    ["no body at all", undefined, "invalidReceived"],
    ["a non-boolean received", { received: "true" }, "invalidReceived"],
    ["a waive without a reason", { received: false }, "reasonRequired"],
    ["a waive with a null reason", { received: false, reason: null }, "reasonRequired"],
    ["a waive with a blank reason", { received: false, reason: "   " }, "reasonRequired"],
    ["a waive with a non-string reason", { received: false, reason: 5 }, "invalidReason"],
    [
      "a waive with an over-long reason",
      { received: false, reason: "a".repeat(SETTLEMENT_TEXT_MAX_LENGTH + 1) },
      "invalidReason",
    ],
  ])("rejects %s", (_label, value, error) => {
    expect(parseDepositCollection(value)).toEqual({ error });
  });
});

describe("validateRecordDepositCollection", () => {
  const run = (body: unknown, params: Record<string, string> = { id: "12" }) => {
    const req = { params, body } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;
    validateRecordDepositCollection(req, {} as Response, next);
    return { req, next };
  };

  it("narrows a valid body and passes it on", () => {
    const { req, next } = run({ received: false, reason: " Cliente de confianza ", sneaky: 1 });
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ received: false, reason: "Cliente de confianza" });
  });

  it("400s a malformed id before reading the body", () => {
    const { next } = run({ received: true }, { id: "abc" });
    expectRejected(next, "invalidId");
  });

  it("400s an unusable body with its own message", () => {
    const { next } = run({ received: false });
    expectRejected(next, "reasonRequired");
  });
});

describe("validateClearDepositCollection", () => {
  it("passes a valid id and 400s a malformed one", () => {
    const next = vi.fn() as unknown as NextFunction;
    validateClearDepositCollection({ params: { id: "12" } } as unknown as Request, {} as Response, next);
    expect(next).toHaveBeenCalled();

    const refused = vi.fn() as unknown as NextFunction;
    validateClearDepositCollection({ params: { id: "0" } } as unknown as Request, {} as Response, refused);
    expectRejected(refused, "invalidId");
  });
});
