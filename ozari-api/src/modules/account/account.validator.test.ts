import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { validateUpdateAccountPreferences } from "./account.validator.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

const run = (body: unknown): { next: NextFunction; req: Request } => {
  const req = { body } as Request;
  const next = vi.fn();
  validateUpdateAccountPreferences(req, {} as Response, next);
  return { next, req };
};

const rejectedWith = (key: string): void => {
  expect(sendOzariError).toHaveBeenCalledWith(
    expect.anything(),
    HttpEnum.BAD_REQUEST,
    `account.validators.${key}`,
  );
};

beforeEach(() => vi.clearAllMocks());

describe("validateUpdateAccountPreferences", () => {
  it.each([1, 3, 365])("accepts %i days", (days) => {
    const { next, req } = run({ orderBilledDays: days });
    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ orderBilledDays: days });
  });

  it("accepts null — back to the automatic (by-dates) default", () => {
    const { next, req } = run({ orderBilledDays: null });
    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ orderBilledDays: null });
  });

  it("drops anything that is not part of the contract", () => {
    const { req } = run({ orderBilledDays: 2, isAdmin: true });
    expect(req.body).toEqual({ orderBilledDays: 2 });
  });

  it.each([undefined, null, "x", {}])("refuses a body without the key (%s)", (body) => {
    const { next } = run(body);
    expect(next).not.toHaveBeenCalled();
    rejectedWith("missingOrderBilledDays");
  });

  it.each([0, -1, 366, 1.5, "3", true])("refuses %s days", (days) => {
    const { next } = run({ orderBilledDays: days });
    expect(next).not.toHaveBeenCalled();
    rejectedWith("invalidOrderBilledDays");
  });
});
