import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMfaAttempts,
  getMfaAttemptCount,
  recordFailedMfa,
} from "./mfaRateLimit.middleware.js";
import { logSecurityAudit } from "@/config/auditLogger.js";

vi.mock("@/config/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((k: string) => k) } }));
vi.mock("@/config/auditLogger.js", () => ({
  logSecurityAudit: vi.fn(),
  AuditAction: { ACCOUNT_LOCKED: "ACCOUNT_LOCKED" },
}));

const userId = 9911;

beforeEach(() => {
  vi.clearAllMocks();
  clearMfaAttempts(userId);
});
afterEach(() => {
  vi.unstubAllEnvs();
  clearMfaAttempts(userId);
});

describe("mfaRateLimit — remaining branches", () => {
  it("getMfaAttemptCount returns the live (non-zero) count", () => {
    recordFailedMfa(userId);
    recordFailedMfa(userId);
    expect(getMfaAttemptCount(userId)).toBe(2);
  });

  it("audit-logs the account lock in a deployed environment", () => {
    vi.stubEnv("NODE_ENV", "staging");
    for (let i = 0; i < 5; i++) recordFailedMfa(userId);
    expect(logSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ACCOUNT_LOCKED", userId }),
    );
  });
});
