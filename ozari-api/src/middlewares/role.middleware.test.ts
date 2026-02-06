import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, NextFunction } from "express";
import { isGrantedRoles } from "./role.middleware.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";

vi.mock("@/config/logger.js", () => ({
  logger: {
    error: vi.fn(),
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

describe("Role Middleware", () => {
  let mockReq: Partial<CustomRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      method: "GET",
      originalUrl: "/api/test",
      user: undefined,
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  it("should reject request without user", () => {
    const middleware = isGrantedRoles([RolesEnum.ADMIN]);

    middleware(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.UNAUTHORIZED);
  });

  it("should allow admin when admin role required", () => {
    mockReq.user = {
      userId: 1,
      userRole: RolesEnum.Admin,
      tokenType: 0,
      deviceUuid: "test-device",
      jti: "test-jti",
      iat: Date.now(),
      exp: Date.now() + 100000,
    };

    const middleware = isGrantedRoles([RolesEnum.Admin]);

    middleware(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it("should reject client when admin role required", () => {
    mockReq.user = {
      userId: 1,
      userRole: RolesEnum.Client,
      tokenType: 0,
      deviceUuid: "test-device",
      jti: "test-jti",
      iat: Date.now(),
      exp: Date.now() + 100000,
    };

    const middleware = isGrantedRoles([RolesEnum.Admin]);

    middleware(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
  });

  it("should allow multiple roles", () => {
    mockReq.user = {
      userId: 1,
      userRole: RolesEnum.Employee,
      tokenType: 0,
      deviceUuid: "test-device",
      jti: "test-jti",
      iat: Date.now(),
      exp: Date.now() + 100000,
    };

    const middleware = isGrantedRoles([RolesEnum.Admin, RolesEnum.Employee]);

    middleware(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it("should reject when user role not in allowed list", () => {
    mockReq.user = {
      userId: 1,
      userRole: RolesEnum.Client,
      tokenType: 0,
      deviceUuid: "test-device",
      jti: "test-jti",
      iat: Date.now(),
      exp: Date.now() + 100000,
    };

    const middleware = isGrantedRoles([RolesEnum.Admin, RolesEnum.Employee]);

    middleware(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.FORBIDDEN);
  });

  it("should allow client when client role required", () => {
    mockReq.user = {
      userId: 1,
      userRole: RolesEnum.Client,
      tokenType: 0,
      deviceUuid: "test-device",
      jti: "test-jti",
      iat: Date.now(),
      exp: Date.now() + 100000,
    };

    const middleware = isGrantedRoles([RolesEnum.Client]);

    middleware(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it("should work with all three roles", () => {
    mockReq.user = {
      userId: 1,
      userRole: RolesEnum.Employee,
      tokenType: 0,
      deviceUuid: "test-device",
      jti: "test-jti",
      iat: Date.now(),
      exp: Date.now() + 100000,
    };

    const middleware = isGrantedRoles([
      RolesEnum.Admin,
      RolesEnum.Employee,
      RolesEnum.Client,
    ]);

    middleware(
      mockReq as CustomRequest,
      mockRes as Response,
      mockNext as NextFunction,
    );

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});
