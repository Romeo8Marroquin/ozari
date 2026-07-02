import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { validateChangePassword } from "./auth.validator.js";
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

describe("validateChangePassword — field-specific error mapping", () => {
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  const run = (body: unknown): void =>
    validateChangePassword({ body, headers: {} } as Request, mockRes as Response, mockNext);

  it("400 when the current password fails (currentPassword branch)", () => {
    run({ currentPassword: "", newPassword: "Passw0rd!123", confirmPassword: "Passw0rd!123" });
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("400 when the confirm field fails on its own (confirmPassword branch)", () => {
    run({ currentPassword: "OldPass1!234", newPassword: "Passw0rd!123", confirmPassword: "" });
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
