import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  validateChangePassword,
  validateCreateUser,
  validateMfaCode,
  validateMfaDisable,
  validateSignIn,
} from "./auth.validator.js";
import { HttpEnum } from "@models/enums/httpEnum.js";

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

describe("Auth Validators", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      body: {},
      headers: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  describe("validateCreateUser", () => {
    it("should pass validation with valid data", () => {
      mockReq.body = {
        fullName: "John Doe",
        email: "john@example.com",
        password: "SecurePass123!",
        confirmPassword: "SecurePass123!",
        termsAccepted: true,
      };

      validateCreateUser(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should reject if body is missing", () => {
      mockReq.body = undefined;

      validateCreateUser(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject if fullName is invalid", () => {
      mockReq.body = {
        fullName: "AB",
        email: "john@example.com",
        password: "SecurePass123!",
        confirmPassword: "SecurePass123!",
        termsAccepted: true,
      };

      validateCreateUser(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject if email is invalid", () => {
      mockReq.body = {
        fullName: "John Doe",
        email: "invalid-email",
        password: "SecurePass123!",
        confirmPassword: "SecurePass123!",
        termsAccepted: true,
      };

      validateCreateUser(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject if password is weak", () => {
      mockReq.body = {
        fullName: "John Doe",
        email: "john@example.com",
        password: "weak",
        confirmPassword: "weak",
        termsAccepted: true,
      };

      validateCreateUser(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject if passwords do not match", () => {
      mockReq.body = {
        fullName: "John Doe",
        email: "john@example.com",
        password: "SecurePass123!",
        confirmPassword: "DifferentPass123!",
        termsAccepted: true,
      };

      validateCreateUser(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject if confirmPassword is empty", () => {
      mockReq.body = {
        fullName: "John Doe",
        email: "john@example.com",
        password: "SecurePass123!",
        confirmPassword: "",
        termsAccepted: true,
      };

      validateCreateUser(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject if terms not accepted", () => {
      mockReq.body = {
        fullName: "John Doe",
        email: "john@example.com",
        password: "SecurePass123!",
        confirmPassword: "SecurePass123!",
        termsAccepted: false,
      };

      validateCreateUser(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });
  });

  describe("validateSignIn", () => {
    it("should pass validation with valid data", () => {
      mockReq.body = {
        email: "john@example.com",
        password: "SecurePass123!",
      };
      mockReq.headers = {
        "device-uuid": "550e8400-e29b-41d4-a716-446655440000",
      };

      validateSignIn(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should reject if body is missing", () => {
      mockReq.body = undefined;
      mockReq.headers = {
        "device-uuid": "550e8400-e29b-41d4-a716-446655440000",
      };

      validateSignIn(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject if email is invalid", () => {
      mockReq.body = {
        email: "invalid-email",
        password: "SecurePass123!",
      };
      mockReq.headers = {
        "device-uuid": "550e8400-e29b-41d4-a716-446655440000",
      };

      validateSignIn(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject if password is missing", () => {
      mockReq.body = {
        email: "john@example.com",
        password: "",
      };
      mockReq.headers = {
        "device-uuid": "550e8400-e29b-41d4-a716-446655440000",
      };

      validateSignIn(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject if deviceUuid is invalid", () => {
      mockReq.body = {
        email: "john@example.com",
        password: "SecurePass123!",
      };
      mockReq.headers = {
        "device-uuid": "not-a-uuid",
      };

      validateSignIn(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should handle validation errors with missing field path", () => {
      mockReq.body = {};
      mockReq.headers = {};

      validateSignIn(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should handle unexpected validation field", () => {
      mockReq.body = {
        email: "john@example.com",
        password: "SecurePass123!",
        unexpectedField: "value",
      };
      mockReq.headers = {
        "device-uuid": "550e8400-e29b-41d4-a716-446655440000",
      };

      validateSignIn(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe("validateChangePassword", () => {
    it("should pass with valid data", () => {
      mockReq.body = {
        currentPassword: "OldSecurePass123!",
        newPassword: "NewSecurePass123!",
        confirmPassword: "NewSecurePass123!",
      };

      validateChangePassword(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should reject a weak new password", () => {
      mockReq.body = {
        currentPassword: "OldSecurePass123!",
        newPassword: "weak",
        confirmPassword: "weak",
      };

      validateChangePassword(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject when confirmation does not match", () => {
      mockReq.body = {
        currentPassword: "OldSecurePass123!",
        newPassword: "NewSecurePass123!",
        confirmPassword: "DifferentPass123!",
      };

      validateChangePassword(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject a missing body", () => {
      mockReq.body = undefined;

      validateChangePassword(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });
  });

  describe("validateMfaCode", () => {
    it("should pass with a 6-digit TOTP code", () => {
      mockReq.body = { code: "123456" };

      validateMfaCode(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it("should pass with a recovery code", () => {
      mockReq.body = { code: "ABCD2345EFGH6789" };

      validateMfaCode(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it("should reject a too-short code", () => {
      mockReq.body = { code: "12" };

      validateMfaCode(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });
  });

  describe("validateMfaDisable", () => {
    it("should pass with a password", () => {
      mockReq.body = { password: "OldSecurePass123!" };

      validateMfaDisable(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it("should reject an empty password", () => {
      mockReq.body = { password: "" };

      validateMfaDisable(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });
  });
});
