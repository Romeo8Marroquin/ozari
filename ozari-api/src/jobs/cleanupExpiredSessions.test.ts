import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanupExpiredSessions } from "./cleanupExpiredSessions.js";

vi.mock("@/services/prisma.service.js", () => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/config/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Cleanup Expired Sessions Job", () => {
  let mockDeleteMany: ReturnType<typeof vi.fn>;
  let mockResetTokenDeleteMany: ReturnType<typeof vi.fn>;
  let mockAuthAttemptDeleteMany: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDeleteMany = vi.fn();
    mockResetTokenDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

    mockAuthAttemptDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

    const { getPrismaClient } = await import("@/services/prisma.service.js");
    (getPrismaClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      jwtSession: {
        deleteMany: mockDeleteMany,
      },
      passwordResetToken: {
        deleteMany: mockResetTokenDeleteMany,
      },
      authAttempt: {
        deleteMany: mockAuthAttemptDeleteMany,
      },
    });
  });

  it("should delete expired and old inactive sessions", async () => {
    mockDeleteMany.mockResolvedValue({ count: 42 });

    await cleanupExpiredSessions();

    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lte: expect.any(Date) } },
          {
            isActive: false,
            issuedAt: { lte: expect.any(Date) },
          },
        ],
      },
    });
  });

  it("should log success message with count", async () => {
    const { logger } = await import("@/config/logger.js");
    mockDeleteMany.mockResolvedValue({ count: 15 });

    await cleanupExpiredSessions();

    expect(logger.info).toHaveBeenCalledWith(
      "[Cleanup Job] Starting expired sessions cleanup",
    );
    expect(logger.info).toHaveBeenCalledWith(
      "[Cleanup Job] Successfully cleaned up 15 expired/inactive sessions",
    );
  });

  it("should handle zero deletions", async () => {
    const { logger } = await import("@/config/logger.js");
    mockDeleteMany.mockResolvedValue({ count: 0 });

    await cleanupExpiredSessions();

    expect(logger.info).toHaveBeenCalledWith(
      "[Cleanup Job] Successfully cleaned up 0 expired/inactive sessions",
    );
  });

  it("should throw error on failure", async () => {
    const { logger } = await import("@/config/logger.js");
    const testError = new Error("Database connection failed");
    mockDeleteMany.mockRejectedValue(testError);

    await expect(cleanupExpiredSessions()).rejects.toThrow(
      "Database connection failed",
    );

    expect(logger.error).toHaveBeenCalledWith(
      "[Cleanup Job] Failed to cleanup expired sessions",
      testError,
    );
  });

  it("should delete sessions based on expiration date", async () => {
    mockDeleteMany.mockResolvedValue({ count: 10 });

    await cleanupExpiredSessions();

    const callArgs = mockDeleteMany.mock.calls[0]?.[0];
    const expiresAtCondition = callArgs?.where.OR[0]?.expiresAt.lte;

    // Verify that expiresAt is approximately now
    expect(expiresAtCondition).toBeInstanceOf(Date);
    const diff = Math.abs(
      expiresAtCondition.getTime() - new Date().getTime(),
    );
    expect(diff).toBeLessThan(1000); // Within 1 second
  });

  it("should delete inactive sessions older than 7 days", async () => {
    mockDeleteMany.mockResolvedValue({ count: 5 });

    await cleanupExpiredSessions();

    const callArgs = mockDeleteMany.mock.calls[0]?.[0];
    const issuedAtCondition = callArgs?.where.OR[1]?.issuedAt.lte;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Verify that issuedAt is approximately 7 days ago
    expect(issuedAtCondition).toBeInstanceOf(Date);
    const diff = Math.abs(
      issuedAtCondition.getTime() - sevenDaysAgo.getTime(),
    );
    expect(diff).toBeLessThan(1000); // Within 1 second
  });

  it("should purge expired password-reset tokens and log the count", async () => {
    const { logger } = await import("@/config/logger.js");
    mockDeleteMany.mockResolvedValue({ count: 0 });
    mockResetTokenDeleteMany.mockResolvedValue({ count: 3 });

    await cleanupExpiredSessions();

    expect(mockResetTokenDeleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: expect.any(Date) } },
    });
    expect(logger.info).toHaveBeenCalledWith(
      "[Cleanup Job] Successfully cleaned up 3 expired password-reset tokens",
    );
  });

  it("purges LAPSED brute-force counters, and never a live one", async () => {
    // A live window is what a lockout IS: deleting it here would hand an attacker a free reset, so
    // the cutoff has to be `lte: now` and nothing wider.
    const { logger } = await import("@/config/logger.js");
    mockDeleteMany.mockResolvedValue({ count: 0 });
    mockAuthAttemptDeleteMany.mockResolvedValue({ count: 7 });

    await cleanupExpiredSessions();

    expect(mockAuthAttemptDeleteMany).toHaveBeenCalledWith({
      where: { resetAt: { lte: expect.any(Date) } },
    });
    expect(logger.info).toHaveBeenCalledWith(
      "[Cleanup Job] Successfully cleaned up 7 lapsed auth attempt counters",
    );
  });
});
