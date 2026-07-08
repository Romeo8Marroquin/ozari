import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  validateForgotPassword,
  validateResetPassword,
} from "./auth.validator.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

vi.mock("@/config/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((k: string) => k) } }));
vi.mock("@models/http/ozariErrorModel.js", () => ({
  sendOzariError: vi.fn((res: Response, status: number) => {
    res.status(status).json({ success: false });
  }),
}));

const VALID_PASSWORD = "Passw0rd!123";

describe("validateForgotPassword", () => {
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  const run = (body: unknown): void =>
    validateForgotPassword(
      { body, headers: {} } as Request,
      mockRes as Response,
      mockNext,
    );

  it("400 when the body is not an object", () => {
    run(null);
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("400 when the email is invalid", () => {
    run({ email: "not-an-email" });
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("calls next() and normalizes the email when valid", () => {
    const req = { body: { email: "Ana@Example.com" }, headers: {} } as Request;
    validateForgotPassword(req, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(req.body.email).toBe("ana@example.com");
  });
});

describe("validateResetPassword — field-specific error mapping", () => {
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  const run = (body: unknown): void =>
    validateResetPassword(
      { body, headers: {} } as Request,
      mockRes as Response,
      mockNext,
    );

  it("400 when the body is not an object", () => {
    run(undefined);
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("400 when the token is missing (token branch)", () => {
    run({
      token: "",
      newPassword: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    });
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("400 when the new password is weak (newPassword branch)", () => {
    run({ token: "tok", newPassword: "weak", confirmPassword: "weak" });
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("400 when the passwords do not match (refine branch)", () => {
    run({
      token: "tok",
      newPassword: VALID_PASSWORD,
      confirmPassword: "N0tMatching!99",
    });
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("400 when confirmPassword is empty (confirmPassword branch)", () => {
    run({ token: "tok", newPassword: VALID_PASSWORD, confirmPassword: "" });
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("calls next() when the payload is valid", () => {
    run({
      token: "a-valid-token",
      newPassword: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    });
    expect(mockNext).toHaveBeenCalled();
  });
});
