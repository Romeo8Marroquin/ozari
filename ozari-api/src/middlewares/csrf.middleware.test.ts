import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  generateCsrfToken,
  setCsrfToken,
  verifyCsrfToken,
} from "./csrf.middleware.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

// The CSRF token is HMAC-signed with a key derived from JWT_SECRET; it must be set for
// generate/verify to work.
process.env["JWT_SECRET"] = "test-jwt-secret-for-csrf-0123456789-abcdef";

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
      headers: {},
    };
    mockRes = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  describe("generateCsrfToken", () => {
    it("should generate a signed token in <nonce>.<hmac> form", () => {
      const token = generateCsrfToken();
      expect(typeof token).toBe("string");
      const [nonce, signature, extra] = token.split(".");
      expect(extra).toBeUndefined();
      expect(nonce).toHaveLength(64); // 32-byte nonce as hex
      expect(signature).toHaveLength(64); // HMAC-SHA256 as hex
    });

    it("should generate unique tokens", () => {
      expect(generateCsrfToken()).not.toBe(generateCsrfToken());
    });
  });

  describe("setCsrfToken", () => {
    it("should issue the token in the x-csrf-token response header", () => {
      const token = setCsrfToken(mockRes as Response);

      expect(token).toBeDefined();
      expect(mockRes.header).toHaveBeenCalledWith("x-csrf-token", token);
    });

    it("should return a token that subsequently verifies", () => {
      const token = setCsrfToken(mockRes as Response);
      mockReq.method = "POST";
      mockReq.headers = { "x-csrf-token": token };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe("verifyCsrfToken", () => {
    it.each(["GET", "HEAD", "OPTIONS"])(
      "should allow safe method %s without a token",
      (method) => {
        mockReq.method = method;

        verifyCsrfToken(
          mockReq as Request,
          mockRes as Response,
          mockNext as NextFunction,
        );

        expect(mockNext).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      },
    );

    it("should reject POST without a token", () => {
      mockReq.method = "POST";

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
    });

    it("should reject a token with no signature separator", () => {
      mockReq.method = "POST";
      mockReq.headers = { "x-csrf-token": "no-separator-here" };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
    });

    it("should reject a token with a tampered signature", () => {
      const [nonce] = generateCsrfToken().split(".");
      mockReq.method = "POST";
      mockReq.headers = { "x-csrf-token": `${nonce}.${"0".repeat(64)}` };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
    });

    it("should reject a token whose nonce was swapped (signature no longer matches)", () => {
      const tokenA = generateCsrfToken();
      const tokenB = generateCsrfToken();
      const nonceA = tokenA.split(".")[0];
      const sigB = tokenB.split(".")[1];
      mockReq.method = "POST";
      mockReq.headers = { "x-csrf-token": `${nonceA}.${sigB}` };

      verifyCsrfToken(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
    });

    it.each(["POST", "PUT", "DELETE", "PATCH"])(
      "should accept %s with a valid signed token",
      (method) => {
        const token = generateCsrfToken();
        mockReq.method = method;
        mockReq.headers = { "x-csrf-token": token };

        verifyCsrfToken(
          mockReq as Request,
          mockRes as Response,
          mockNext as NextFunction,
        );

        expect(mockNext).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      },
    );
  });
});
