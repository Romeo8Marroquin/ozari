import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

vi.mock("@/config/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/config/i18n.js", () => ({
  i18next: {
    t: vi.fn((key: string, params?: unknown) => {
      if (typeof params === "object" && params !== null && "minutes" in params) {
        return `Too many attempts. Try again in ${(params as { minutes: number }).minutes} minutes`;
      }
      return key;
    }),
  },
}));

vi.mock("@models/http/ozariErrorModel.js", () => ({
  sendOzariError: vi.fn((res: Response, status: number, message: string) => {
    res.status(status).json({ success: false, message });
  }),
}));

vi.mock("@/config/auditLogger.js", () => ({
  AuditAction: { ACCOUNT_LOCKED: "ACCOUNT_LOCKED" },
  logSecurityAudit: vi.fn(),
}));

// The COUNTER is the throttle service's business (and has its own suite, including the atomic
// increment and the fail-open paths). What is asserted here is the middleware's own job: whether it
// refuses, what it says, what it audits — and that it never hands the store an email address.
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
import { encryptSha256Sync } from "@helpers/encryption.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  getAttemptCount,
  recordFailedLogin,
} from "./loginRateLimit.middleware.js";

const EMAIL = "test@example.com";
const SUBJECT = encryptSha256Sync(EMAIL);

let req: Partial<Request>;
let res: Partial<Response>;
let next: NextFunction;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  attemptState.mockResolvedValue(null);
  recordFailedAttempt.mockResolvedValue({ attempts: 1, remainingMinutes: 15 });
  req = { body: { email: EMAIL } };
  res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  next = vi.fn();
});

describe("checkLoginRateLimit", () => {
  it("allows an account with no live window", async () => {
    await checkLoginRateLimit(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows an account still under the threshold", async () => {
    attemptState.mockResolvedValue({ attempts: 4, remainingMinutes: 9 });
    await checkLoginRateLimit(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it("REFUSES once the attempts are spent, and says how long is left", async () => {
    attemptState.mockResolvedValue({ attempts: 5, remainingMinutes: 9 });
    await checkLoginRateLimit(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(HttpEnum.TOO_MANY_REQUESTS);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("9 minutes") }),
    );
  });

  it("counts against the email's HASH, never the address itself", async () => {
    // A table of plaintext emails would reveal which ones have accounts — exactly what the login
    // endpoint's constant-time path exists to avoid leaking.
    await checkLoginRateLimit(req as Request, res as Response, next);
    expect(attemptState).toHaveBeenCalledWith("LOGIN", SUBJECT);
    expect(attemptState).not.toHaveBeenCalledWith("LOGIN", EMAIL);
  });

  it("passes through a request with no email — the validator owns that error", async () => {
    req.body = {};
    await checkLoginRateLimit(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(attemptState).not.toHaveBeenCalled();
  });
});

describe("recordFailedLogin", () => {
  it("records the failure against the hashed subject", async () => {
    await recordFailedLogin(EMAIL);
    expect(recordFailedAttempt).toHaveBeenCalledWith("LOGIN", SUBJECT, 15 * 60 * 1000);
  });

  it("audit-logs the lock-out in a deployed environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    recordFailedAttempt.mockResolvedValue({ attempts: 5, remainingMinutes: 15 });
    await recordFailedLogin(EMAIL);
    expect(logSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ACCOUNT_LOCKED", email: EMAIL }),
    );
  });

  it("does NOT audit-log in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    recordFailedAttempt.mockResolvedValue({ attempts: 5, remainingMinutes: 15 });
    await recordFailedLogin(EMAIL);
    expect(logSecurityAudit).not.toHaveBeenCalled();
  });

  it("says nothing at all when the counter could not be written", async () => {
    // The store fails open; a login that could not be counted is still a login, not an incident.
    recordFailedAttempt.mockResolvedValue(null);
    await recordFailedLogin(EMAIL);
    expect(logSecurityAudit).not.toHaveBeenCalled();
  });
});

describe("clearLoginAttempts / getAttemptCount", () => {
  it("clears the subject's window on a successful login", async () => {
    await clearLoginAttempts(EMAIL);
    expect(clearAttempts).toHaveBeenCalledWith("LOGIN", SUBJECT);
  });

  it("reports the live count, and 0 when there is no window", async () => {
    attemptState.mockResolvedValue({ attempts: 2, remainingMinutes: 5 });
    await expect(getAttemptCount(EMAIL)).resolves.toBe(2);

    attemptState.mockResolvedValue(null);
    await expect(getAttemptCount(EMAIL)).resolves.toBe(0);
  });
});
