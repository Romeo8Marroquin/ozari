import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLoginAttempts,
  getAttemptCount,
  recordFailedLogin,
} from "./loginRateLimit.middleware.js";
import { logSecurityAudit } from "@/config/auditLogger.js";

vi.mock("@/config/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((k: string) => k) } }));
vi.mock("@/config/auditLogger.js", () => ({
  logSecurityAudit: vi.fn(),
  AuditAction: { ACCOUNT_LOCKED: "ACCOUNT_LOCKED" },
}));

const email = "branch@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  clearLoginAttempts(email);
});
afterEach(() => {
  vi.unstubAllEnvs();
  clearLoginAttempts(email);
});

describe("loginRateLimit — remaining branches", () => {
  it("getAttemptCount returns the live (non-zero) count", () => {
    recordFailedLogin(email);
    expect(getAttemptCount(email)).toBeGreaterThan(0);
  });

  it("audit-logs the account lock in a deployed environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (let i = 0; i < 10; i++) recordFailedLogin(email);
    expect(logSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ACCOUNT_LOCKED", email }),
    );
  });
});
