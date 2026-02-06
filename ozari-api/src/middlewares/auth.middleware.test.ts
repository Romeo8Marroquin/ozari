import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyJwt } from "./auth.middleware.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { TokenEnum } from "@models/enums/tokenEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";

vi.mock("@/config/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/config/i18n.js", () => ({
  i18next: {
    t: vi.fn((key: string) => key),
  },
}));

vi.mock("@models/http/ozariErrorModel.js", () => ({
  sendOzariError: vi.fn((res: Response, status: number) => {
    res.status(status).json({ success: false });
  }),
}));

vi.mock("@/services/prisma.service.js", () => ({
  getPrismaClient: vi.fn(),
}));

describe("Auth Middleware", () => {
  let mockReq: Partial<CustomRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  const originalJwtSecret = process.env["JWT_SECRET"];

  beforeEach(() => {
    mockReq = {
      header: vi.fn(),
      user: undefined,
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    process.env["JWT_SECRET"] = "test-jwt-secret-12345678901234567890";
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (originalJwtSecret) {
      process.env["JWT_SECRET"] = originalJwtSecret;
    }
  });

  it("should reject request without JWT_SECRET", async () => {
    delete process.env["JWT_SECRET"];

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(
      HttpEnum.INTERNAL_SERVER_ERROR,
    );
  });

  it("should reject request without Authorization header", async () => {
    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should reject request with malformed Authorization header", async () => {
    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue("InvalidToken");

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should reject expired token", async () => {
    const expiredToken = jwt.sign(
      {
        userId: 1,
        userRole: RolesEnum.CLIENT,
        tokenType: TokenEnum.ACCESS_TOKEN,
        deviceUuid: "test-device",
        jti: "test-jti",
      },
      process.env["JWT_SECRET"]!,
      { expiresIn: "-1h" },
    );

    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      `Bearer ${expiredToken}`,
    );

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should reject token with invalid signature", async () => {
    const token = jwt.sign(
      {
        userId: 1,
        userRole: RolesEnum.CLIENT,
        tokenType: TokenEnum.ACCESS_TOKEN,
        deviceUuid: "test-device",
        jti: "test-jti",
      },
      "wrong-secret",
      { expiresIn: "1h" },
    );

    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      `Bearer ${token}`,
    );

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should reject refresh token when access token expected", async () => {
    const refreshToken = jwt.sign(
      {
        userId: 1,
        userRole: RolesEnum.CLIENT,
        tokenType: TokenEnum.REFRESH_TOKEN,
        deviceUuid: "test-device",
        jti: "test-jti",
      },
      process.env["JWT_SECRET"]!,
      { expiresIn: "1h" },
    );

    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      `Bearer ${refreshToken}`,
    );

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should reject token when no active session exists", async () => {
    const token = jwt.sign(
      {
        userId: 1,
        userRole: RolesEnum.CLIENT,
        tokenType: TokenEnum.ACCESS_TOKEN,
        deviceUuid: "test-device",
        jti: "test-jti",
      },
      process.env["JWT_SECRET"]!,
      { expiresIn: "1h" },
    );

    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      `Bearer ${token}`,
    );

    const { getPrismaClient } = await import("@/services/prisma.service.js");
    (getPrismaClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      jwtSession: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should reject token when multiple active sessions exist", async () => {
    const token = jwt.sign(
      {
        userId: 1,
        userRole: RolesEnum.CLIENT,
        tokenType: TokenEnum.ACCESS_TOKEN,
        deviceUuid: "test-device",
        jti: "test-jti",
      },
      process.env["JWT_SECRET"]!,
      { expiresIn: "1h" },
    );

    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      `Bearer ${token}`,
    );

    const { getPrismaClient } = await import("@/services/prisma.service.js");
    (getPrismaClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      jwtSession: {
        findMany: vi.fn().mockResolvedValue([
          { jti: "test-jti", expiresAt: new Date(Date.now() + 100000) },
          { jti: "test-jti-2", expiresAt: new Date(Date.now() + 100000) },
        ]),
      },
    });

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should reject token when jti mismatch", async () => {
    const token = jwt.sign(
      {
        userId: 1,
        userRole: RolesEnum.CLIENT,
        tokenType: TokenEnum.ACCESS_TOKEN,
        deviceUuid: "test-device",
        jti: "test-jti",
      },
      process.env["JWT_SECRET"]!,
      { expiresIn: "1h" },
    );

    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      `Bearer ${token}`,
    );

    const { getPrismaClient } = await import("@/services/prisma.service.js");
    (getPrismaClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      jwtSession: {
        findMany: vi.fn().mockResolvedValue([
          { jti: "different-jti", expiresAt: new Date(Date.now() + 100000) },
        ]),
      },
    });

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should reject token when session expired", async () => {
    const token = jwt.sign(
      {
        userId: 1,
        userRole: RolesEnum.CLIENT,
        tokenType: TokenEnum.ACCESS_TOKEN,
        deviceUuid: "test-device",
        jti: "test-jti",
      },
      process.env["JWT_SECRET"]!,
      { expiresIn: "1h" },
    );

    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      `Bearer ${token}`,
    );

    const { getPrismaClient } = await import("@/services/prisma.service.js");
    (getPrismaClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      jwtSession: {
        findMany: vi.fn().mockResolvedValue([
          { jti: "test-jti", expiresAt: new Date(Date.now() - 100000) },
        ]),
      },
    });

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should accept valid token with active session", async () => {
    const token = jwt.sign(
      {
        userId: 1,
        userRole: RolesEnum.CLIENT,
        tokenType: TokenEnum.ACCESS_TOKEN,
        deviceUuid: "test-device",
        jti: "test-jti",
      },
      process.env["JWT_SECRET"]!,
      { expiresIn: "1h" },
    );

    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      `Bearer ${token}`,
    );

    const { getPrismaClient } = await import("@/services/prisma.service.js");
    (getPrismaClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      jwtSession: {
        findMany: vi.fn().mockResolvedValue([
          { jti: "test-jti", expiresAt: new Date(Date.now() + 100000) },
        ]),
      },
    });

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.user).toBeDefined();
    expect(mockReq.user?.userId).toBe(1);
    expect(mockReq.user?.userRole).toBe(RolesEnum.CLIENT);
  });

  it("should handle database errors gracefully", async () => {
    const token = jwt.sign(
      {
        userId: 1,
        userRole: RolesEnum.CLIENT,
        tokenType: TokenEnum.ACCESS_TOKEN,
        deviceUuid: "test-device",
        jti: "test-jti",
      },
      process.env["JWT_SECRET"]!,
      { expiresIn: "1h" },
    );

    (mockReq.header as ReturnType<typeof vi.fn>).mockReturnValue(
      `Bearer ${token}`,
    );

    const { getPrismaClient } = await import("@/services/prisma.service.js");
    (getPrismaClient as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Database connection failed"),
    );

    await verifyJwt(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(
      HttpEnum.INTERNAL_SERVER_ERROR,
    );
  });
});
