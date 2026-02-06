import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  validateCreateProduct,
  validateUpdateProduct,
} from "./products.validator.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";

vi.mock("@/config/logger.js", () => ({
  logger: {
    warn: vi.fn(),
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

vi.mock("@/services/prisma.service.js", () => ({
  getPrismaClient: vi.fn(),
}));

vi.mock("@/config/app.js", () => ({
  appConfig: {
    host: "http://localhost:3000",
  },
}));

describe("Products Validator", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

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
  });

  describe("validateCreateProduct", () => {
    it("should reject invalid businessTypeId", async () => {
      mockReq.body = {
        businessTypeId: 999,
        categoryId: 1,
        currencyId: 1,
        name: "Test Product",
        quantity: 10,
      };

      await validateCreateProduct(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject missing businessTypeId", async () => {
      mockReq.body = {
        categoryId: 1,
        currencyId: 1,
        name: "Test Product",
        quantity: 10,
      };

      await validateCreateProduct(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject invalid categoryId", async () => {
      mockReq.body = {
        businessTypeId: BusinessTypeEnum.RENT,
        categoryId: 999,
        currencyId: 1,
        name: "Test Product",
        quantity: 10,
      };

      const { getPrismaClient } = await import("@/services/prisma.service.js");
      (getPrismaClient as ReturnType<typeof vi.fn>).mockResolvedValue({
        productCategory: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      });

      await validateCreateProduct(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject invalid currencyId", async () => {
      mockReq.body = {
        businessTypeId: BusinessTypeEnum.RENT,
        categoryId: 1,
        currencyId: 999,
        name: "Test Product",
        quantity: 10,
      };

      const { getPrismaClient } = await import("@/services/prisma.service.js");
      (getPrismaClient as ReturnType<typeof vi.fn>).mockResolvedValue({
        productCategory: {
          findFirst: vi.fn().mockResolvedValue({ id: 1, isActive: true }),
        },
        currency: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      });

      await validateCreateProduct(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

  });

  describe("validateUpdateProduct", () => {
    it("should reject invalid product ID", async () => {
      mockReq.body = {
        productId: "invalid",
      };

      await validateUpdateProduct(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

    it("should reject non-existent product", async () => {
      mockReq.body = {
        productId: 999,
      };

      const { getPrismaClient } = await import("@/services/prisma.service.js");
      (getPrismaClient as ReturnType<typeof vi.fn>).mockResolvedValue({
        product: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      });

      await validateUpdateProduct(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    });

  });
});
