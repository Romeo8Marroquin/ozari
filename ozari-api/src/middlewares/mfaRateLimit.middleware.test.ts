import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Response, NextFunction } from "express";
import {
  checkMfaRateLimit,
  recordFailedMfa,
  clearMfaAttempts,
  getMfaAttemptCount,
} from "./mfaRateLimit.middleware.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

vi.mock("@/config/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/config/i18n.js", () => ({
  i18next: { t: vi.fn((key: string) => key) },
}));

vi.mock("@/config/auditLogger.js", () => ({
  logSecurityAudit: vi.fn(),
  AuditAction: { ACCOUNT_LOCKED: "ACCOUNT_LOCKED" },
}));

vi.mock("@models/http/ozariErrorModel.js", () => ({
  sendOzariError: vi.fn((res: Response, status: number) => {
    res.status(status).json({ success: false });
  }),
}));

describe("MFA Rate Limit Middleware", () => {
  const userId = 4242;
  let mockReq: Partial<CustomRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      mfaToken: { userId, deviceUuid: "d", tokenType: 3, iat: 0 },
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearMfaAttempts(userId);
  });

  it("allows requests under the threshold", () => {
    recordFailedMfa(userId);
    recordFailedMfa(userId);

    checkMfaRateLimit(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it("blocks after five failed attempts", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedMfa(userId);
    }

    checkMfaRateLimit(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.TOO_MANY_REQUESTS);
  });

  it("clears attempts on success", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedMfa(userId);
    }
    clearMfaAttempts(userId);

    checkMfaRateLimit(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
    expect(getMfaAttemptCount(userId)).toBe(0);
  });

  it("passes through when there is no MFA token", () => {
    mockReq.mfaToken = undefined;

    checkMfaRateLimit(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
  });
});
