import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Response } from "express";

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

// Same boundary as the login limiter's suite: the counter belongs to the throttle service (tested
// there); this file asserts what the middleware decides with it.
const { attemptState, recordFailedAttempt, clearAttempts } = vi.hoisted(() => ({
  attemptState: vi.fn(),
  recordFailedAttempt: vi.fn(),
  clearAttempts: vi.fn(),
}));
vi.mock("@services/authThrottle.service.js", () => ({
  AuthAttemptScope: { LOGIN: "LOGIN", MFA: "MFA" },
  attemptState,
  recordFailedAttempt,
  clearAttempts,
}));

import { logSecurityAudit } from "@/config/auditLogger.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import {
  checkMfaRateLimit,
  clearMfaAttempts,
  getMfaAttemptCount,
  recordFailedMfa,
} from "./mfaRateLimit.middleware.js";

const USER_ID = 4242;

let req: Partial<CustomRequest>;
let res: Partial<Response>;
let next: NextFunction;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  attemptState.mockResolvedValue(null);
  recordFailedAttempt.mockResolvedValue({ attempts: 1, remainingMinutes: 15 });
  req = { mfaToken: { userId: USER_ID, deviceUuid: "d", tokenType: 3, iat: 0 } };
  res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  next = vi.fn();
});

describe("checkMfaRateLimit", () => {
  it("allows a user under the threshold", async () => {
    attemptState.mockResolvedValue({ attempts: 2, remainingMinutes: 14 });
    await checkMfaRateLimit(req as CustomRequest, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("blocks once the attempts are spent", async () => {
    attemptState.mockResolvedValue({ attempts: 5, remainingMinutes: 12 });
    await checkMfaRateLimit(req as CustomRequest, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(HttpEnum.TOO_MANY_REQUESTS);
  });

  it("counts against the USER, which is the thing the code protects", async () => {
    // Unlike the login limiter's email, a user id is not information worth hiding — and this runs
    // after the MFA challenge token is verified, so it is trusted.
    await checkMfaRateLimit(req as CustomRequest, res as Response, next);
    expect(attemptState).toHaveBeenCalledWith("MFA", String(USER_ID));
  });

  it("passes through when there is no MFA token", async () => {
    req.mfaToken = undefined;
    await checkMfaRateLimit(req as CustomRequest, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(attemptState).not.toHaveBeenCalled();
  });
});

describe("recordFailedMfa / clearMfaAttempts / getMfaAttemptCount", () => {
  it("records against the user's window", async () => {
    await recordFailedMfa(USER_ID);
    expect(recordFailedAttempt).toHaveBeenCalledWith("MFA", String(USER_ID), 15 * 60 * 1000);
    expect(logSecurityAudit).not.toHaveBeenCalled();
  });

  it("audit-logs the lock-out in a deployed environment", async () => {
    vi.stubEnv("NODE_ENV", "staging");
    recordFailedAttempt.mockResolvedValue({ attempts: 5, remainingMinutes: 15 });
    await recordFailedMfa(USER_ID);
    expect(logSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ACCOUNT_LOCKED", userId: USER_ID }),
    );
  });

  it("does NOT audit-log in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    recordFailedAttempt.mockResolvedValue({ attempts: 5, remainingMinutes: 15 });
    await recordFailedMfa(USER_ID);
    expect(logSecurityAudit).not.toHaveBeenCalled();
  });

  it("says nothing when the counter could not be written", async () => {
    recordFailedAttempt.mockResolvedValue(null);
    await recordFailedMfa(USER_ID);
    expect(logSecurityAudit).not.toHaveBeenCalled();
  });

  it("clears on success and reports the live count", async () => {
    await clearMfaAttempts(USER_ID);
    expect(clearAttempts).toHaveBeenCalledWith("MFA", String(USER_ID));

    attemptState.mockResolvedValue({ attempts: 3, remainingMinutes: 5 });
    await expect(getMfaAttemptCount(USER_ID)).resolves.toBe(3);
    attemptState.mockResolvedValue(null);
    await expect(getMfaAttemptCount(USER_ID)).resolves.toBe(0);
  });
});
