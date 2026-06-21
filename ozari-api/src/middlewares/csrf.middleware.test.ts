import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  generateCsrfToken,
  setCsrfToken,
  clearCsrfToken,
  verifyCsrfToken,
} from "./csrf.middleware.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

vi.mock("@/config/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/config/i18n.js", () => ({
  i18next: {
    t: vi.fn((key: string) => key),
  },
}));

describe("CSRF Middleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      method: "POST",
      originalUrl: "/api/test",
      cookies: {},
      headers: {},
    };
    mockRes = {
      cookie: vi.fn().mockReturnThis(),
      clearCookie: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  describe("generateCsrfToken", () => {
    it("should generate a valid token", () => {
      const token = generateCsrfToken();
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.length).toBe(64); // 32 bytes = 64 hex characters
    });

    it("should generate unique tokens", () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe("setCsrfToken", () => {
    it("should set CSRF token cookie", () => {
      const token = setCsrfToken(mockRes as Response);

      expect(token).toBeDefined();
      expect(mockRes.cookie).toHaveBeenCalledWith(
        "csrf-token",
        token,
        expect.objectContaining({
          httpOnly: false,
          sameSite: "lax",
          secure: false,
          path: "/api",
        }),
      );
    });

    it("should return the generated token", () => {
      const token = setCsrfToken(mockRes as Response);
      expect(token.length).toBe(64);
    });
  });

  describe("clearCsrfToken", () => {
    it("should clear CSRF token cookie", () => {
      clearCsrfToken(mockRes as Response);

      expect(mockRes.clearCookie).toHaveBeenCalledWith("csrf-token", {
        path: "/api",
      });
    });
  });

  describe("verifyCsrfToken", () => {
    it("should allow safe methods without CSRF token", () => {
      mockReq.method = "GET";

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should allow HEAD method without CSRF token", () => {
      mockReq.method = "HEAD";

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it("should allow OPTIONS method without CSRF token", () => {
      mockReq.method = "OPTIONS";

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it("should reject POST without CSRF token", () => {
      mockReq.method = "POST";

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
    });

    it("should reject POST with only cookie token", () => {
      mockReq.method = "POST";
      mockReq.cookies = { "csrf-token": "test-token" };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
    });

    it("should reject POST with only header token", () => {
      mockReq.method = "POST";
      mockReq.headers = { "x-csrf-token": "test-token" };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
    });

    it("should reject POST with mismatched tokens", () => {
      mockReq.method = "POST";
      mockReq.cookies = { "csrf-token": "token1" };
      mockReq.headers = { "x-csrf-token": "token2" };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
    });

    it("should accept POST with matching tokens", () => {
      const token = "valid-csrf-token-hex-string";
      mockReq.method = "POST";
      mockReq.cookies = { "csrf-token": token };
      mockReq.headers = { "x-csrf-token": token };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should accept PUT with matching tokens", () => {
      const token = "valid-csrf-token";
      mockReq.method = "PUT";
      mockReq.cookies = { "csrf-token": token };
      mockReq.headers = { "x-csrf-token": token };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it("should accept DELETE with matching tokens", () => {
      const token = "valid-csrf-token";
      mockReq.method = "DELETE";
      mockReq.cookies = { "csrf-token": token };
      mockReq.headers = { "x-csrf-token": token };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it("should accept PATCH with matching tokens", () => {
      const token = "valid-csrf-token";
      mockReq.method = "PATCH";
      mockReq.cookies = { "csrf-token": token };
      mockReq.headers = { "x-csrf-token": token };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it("should reject tokens with different lengths", () => {
      mockReq.method = "POST";
      mockReq.cookies = { "csrf-token": "short" };
      mockReq.headers = { "x-csrf-token": "much-longer-token" };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
    });
  });
});
