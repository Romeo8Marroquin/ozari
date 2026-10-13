import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import {
  getRegistrationStatus,
  requireRegistrationOpen,
} from "./auth.registration.controller.js";
import type { RegistrationStatusResponseModel } from "./auth.models.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@models/http/ozariSuccessModel.js", () => ({ sendOzariSuccess: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

const answered = (): RegistrationStatusResponseModel =>
  (sendOzariSuccess as Mock).mock.calls[0]?.[3] as RegistrationStatusResponseModel;

const req = { ip: "203.0.113.7" } as Request;
const res = {} as Response;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "staging");
});
afterEach(() => vi.unstubAllEnvs());

describe("getRegistrationStatus", () => {
  it("reports OPEN only when the environment is explicitly opened", () => {
    vi.stubEnv("REGISTRATION_OPEN", "true");
    getRegistrationStatus(req, res);
    expect(answered()).toEqual({ open: true });
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      res,
      HttpEnum.OK,
      "user.registration.statusFetched",
      { open: true },
    );
  });

  it("reports CLOSED when the variable is absent — a deployed environment fails closed", () => {
    vi.stubEnv("REGISTRATION_OPEN", undefined);
    getRegistrationStatus(req, res);
    expect(answered()).toEqual({ open: false });
  });
});

describe("requireRegistrationOpen", () => {
  it("lets the request through to validation when open", () => {
    vi.stubEnv("REGISTRATION_OPEN", "true");
    const next = vi.fn() as NextFunction;
    requireRegistrationOpen(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(sendOzariError).not.toHaveBeenCalled();
  });

  it("answers 403 and never reaches validation or the controller when closed", () => {
    vi.stubEnv("REGISTRATION_OPEN", "false");
    const next = vi.fn() as NextFunction;
    requireRegistrationOpen(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.FORBIDDEN,
      "user.registration.closed",
    );
  });
});
