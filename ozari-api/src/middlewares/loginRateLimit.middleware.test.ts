import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
  getAttemptCount,
} from "./loginRateLimit.middleware.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

vi.mock("@/config/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
  },
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
  sendOzariError: vi.fn((res: Response, status: number) => {
    res.status(status).json({ success: false });
  }),
}));

vi.mock("@/config/auditLogger.js", () => ({
  AuditAction: {
    ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  },
  logSecurityAudit: vi.fn(),
}));

describe("Login Rate Limit Middleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  const testEmail = "test@example.com";

  beforeEach(() => {
    mockReq = {
      body: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
    clearLoginAttempts(testEmail);
  });

  afterEach(() => {
    clearLoginAttempts(testEmail);
  });

  describe("checkLoginRateLimit", () => {
    it("should allow first attempt", () => {
      mockReq.body = { email: testEmail };

      checkLoginRateLimit(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should allow request without email", () => {
      mockReq.body = {};

      checkLoginRateLimit(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should allow attempts within limit", () => {
      mockReq.body = { email: testEmail };

      for (let i = 0; i < 4; i++) {
        recordFailedLogin(testEmail);
      }

      checkLoginRateLimit(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should block after max attempts exceeded", () => {
      mockReq.body = { email: testEmail };

      for (let i = 0; i < 5; i++) {
        recordFailedLogin(testEmail);
      }

      checkLoginRateLimit(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.TOO_MANY_REQUESTS);
    });
  });

  describe("recordFailedLogin", () => {
    it("should record first failed attempt", () => {
      recordFailedLogin(testEmail);

      expect(getAttemptCount(testEmail)).toBe(1);
    });

    it("should increment failed attempts", () => {
      recordFailedLogin(testEmail);
      recordFailedLogin(testEmail);
      recordFailedLogin(testEmail);

      expect(getAttemptCount(testEmail)).toBe(3);
    });

    it("should trigger audit log when account locked", async () => {
      const originalEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "production";

      for (let i = 0; i < 5; i++) {
        recordFailedLogin(testEmail);
      }

      const { logSecurityAudit } = await import("@/config/auditLogger.js");
      expect(logSecurityAudit).toHaveBeenCalled();

      process.env["NODE_ENV"] = originalEnv;
      clearLoginAttempts(testEmail);
    });

    it("should not trigger audit log in development", async () => {
      const originalEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "development";

      for (let i = 0; i < 5; i++) {
        recordFailedLogin(testEmail);
      }

      const { logSecurityAudit } = await import("@/config/auditLogger.js");
      expect(logSecurityAudit).not.toHaveBeenCalled();

      process.env["NODE_ENV"] = originalEnv;
      clearLoginAttempts(testEmail);
    });
  });

  describe("clearLoginAttempts", () => {
    it("should clear existing attempts", () => {
      recordFailedLogin(testEmail);
      recordFailedLogin(testEmail);
      expect(getAttemptCount(testEmail)).toBe(2);

      clearLoginAttempts(testEmail);

      expect(getAttemptCount(testEmail)).toBe(0);
    });

    it("should handle clearing non-existent email", () => {
      clearLoginAttempts("nonexistent@example.com");

      expect(getAttemptCount("nonexistent@example.com")).toBe(0);
    });
  });

  describe("getAttemptCount", () => {
    it("should return zero for new email", () => {
      expect(getAttemptCount(testEmail)).toBe(0);
    });

    it("should return correct count after attempts", () => {
      recordFailedLogin(testEmail);
      recordFailedLogin(testEmail);

      expect(getAttemptCount(testEmail)).toBe(2);
    });

    it("should return zero after clearing", () => {
      recordFailedLogin(testEmail);
      clearLoginAttempts(testEmail);

      expect(getAttemptCount(testEmail)).toBe(0);
    });
  });

  describe("integration scenarios", () => {
    it("should allow login after clearing attempts", () => {
      mockReq.body = { email: testEmail };

      for (let i = 0; i < 5; i++) {
        recordFailedLogin(testEmail);
      }

      clearLoginAttempts(testEmail);

      checkLoginRateLimit(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should handle multiple different emails", () => {
      const email1 = "user1@example.com";
      const email2 = "user2@example.com";

      recordFailedLogin(email1);
      recordFailedLogin(email1);
      recordFailedLogin(email2);

      expect(getAttemptCount(email1)).toBe(2);
      expect(getAttemptCount(email2)).toBe(1);

      clearLoginAttempts(email1);
      clearLoginAttempts(email2);
    });

    it("should block exactly at max attempts", () => {
      mockReq.body = { email: testEmail };

      for (let i = 0; i < 5; i++) {
        recordFailedLogin(testEmail);
      }

      expect(getAttemptCount(testEmail)).toBe(5);

      checkLoginRateLimit(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.TOO_MANY_REQUESTS);

      clearLoginAttempts(testEmail);
    });
  });
});
