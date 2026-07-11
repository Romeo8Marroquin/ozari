import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  validateCreateProduct,
  validateUpdateProduct,
} from "./products.validator.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
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
    maxGlobalAmount: 1000000,
    maxGlobalQuantity: 5000,
  },
}));

/** Prisma with every lookup VALID — individual tests override the piece they need to fail. */
const mockValidPrisma = async () => {
  const prisma = {
    productCategory: { findFirst: vi.fn().mockResolvedValue({ id: 1, isActive: true }) },
    currency: { findFirst: vi.fn().mockResolvedValue({ id: 1, isActive: true }) },
    productDetailType: { findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]) },
    rentTimeUnit: { findFirst: vi.fn().mockResolvedValue({ id: 2, isActive: true }) },
    product: { findFirst: vi.fn().mockResolvedValue({ id: 1, isActive: true }) },
  };
  const { getPrismaClient } = await import("@/services/prisma.service.js");
  (getPrismaClient as ReturnType<typeof vi.fn>).mockResolvedValue(prisma);
  return prisma;
};

/** A fully valid Alquiler create body — tests mutate a copy to hit each rule. */
const validRentBody = () => ({
  businessTypeId: BusinessTypeEnum.RENT,
  categoryId: 1,
  currencyId: 1,
  name: "Mesa redonda blanca",
  description: "Mesa para 8 personas",
  quantity: 40,
  rentPrice: 75,
  rentTimeUnitId: 2,
  replacementPrice: 900,
  productDetails: [{ detailTypeId: 1, detail: "Blanco nieve" }],
});

const validSellBody = () => ({
  businessTypeId: BusinessTypeEnum.SELL,
  categoryId: 1,
  currencyId: 1,
  name: "Vasos plásticos",
  quantity: 100,
  sellPrice: 12.5,
  productDetails: [],
});

const lastErrorKey = (): string | undefined =>
  (sendOzariError as Mock).mock.calls.at(-1)?.[2] as string | undefined;

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

  const run = async () =>
    validateCreateProduct(
      mockReq as Request,
      mockRes as Response,
      mockNext as NextFunction,
    );

  const expectRejected = (key: string) => {
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
    expect(lastErrorKey()).toBe(`products.createProduct.validators.${key}`);
  };

  describe("validateCreateProduct", () => {
    it("should reject invalid businessTypeId", async () => {
      mockReq.body = { ...validRentBody(), businessTypeId: 999 };
      await run();
      expectRejected("invalidBusinessTypeId");
    });

    it("should reject missing businessTypeId", async () => {
      const { businessTypeId: _omit, ...body } = validRentBody();
      mockReq.body = body;
      await run();
      expectRejected("invalidBusinessTypeId");
    });

    it("should reject invalid categoryId", async () => {
      const prisma = await mockValidPrisma();
      prisma.productCategory.findFirst.mockResolvedValue(null);
      mockReq.body = { ...validRentBody(), categoryId: 999 };
      await run();
      expectRejected("invalidCategoryId");
    });

    it("should reject invalid currencyId", async () => {
      const prisma = await mockValidPrisma();
      prisma.currency.findFirst.mockResolvedValue(null);
      mockReq.body = { ...validRentBody(), currencyId: 999 };
      await run();
      expectRejected("invalidCurrencyId");
    });

    it("should reject a malformed description", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validRentBody(), description: "<script>" };
      await run();
      expectRejected("invalidDescription");
    });

    it("should reject a malformed name", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validRentBody(), name: "x" };
      await run();
      expectRejected("invalidName");
    });

    it("should reject a detail with an unknown type", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        productDetails: [{ detailTypeId: 999, detail: "Blanco nieve" }],
      };
      await run();
      expectRejected("invalidDetailTypeId");
    });

    it("should reject a detail with malformed text", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        productDetails: [{ detailTypeId: 1, detail: "@" }],
      };
      await run();
      expectRejected("invalidDetail");
    });

    it("should reject an out-of-range quantity", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validRentBody(), quantity: 5001 };
      await run();
      expectRejected("invalidQuantity");
    });

    it("should reject a non-numeric rentPrice", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validRentBody(), rentPrice: "75" };
      await run();
      expectRejected("invalidRentPrice");
    });

    it("should reject a negative sellPrice", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validSellBody(), sellPrice: -1 };
      await run();
      expectRejected("invalidSellPrice");
    });

    it("should reject an out-of-range replacementPrice", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validRentBody(), replacementPrice: 1000001 };
      await run();
      expectRejected("invalidReplacementPrice");
    });

    // ── The conditional price rule ────────────────────────────────────────────────────────────

    it("Alquiler: rejects a sellPrice", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validRentBody(), sellPrice: 100 };
      await run();
      expectRejected("pricingMismatch");
    });

    it("Alquiler: rejects a missing rentPrice", async () => {
      const { rentPrice: _omit, ...body } = validRentBody();
      await mockValidPrisma();
      mockReq.body = body;
      await run();
      expectRejected("rentPricingRequired");
    });

    it("Alquiler: rejects a missing rentTimeUnitId", async () => {
      const { rentTimeUnitId: _omit, ...body } = validRentBody();
      await mockValidPrisma();
      mockReq.body = body;
      await run();
      expectRejected("invalidRentTimeUnitId");
    });

    it("Alquiler: rejects an unknown/inactive rentTimeUnitId", async () => {
      const prisma = await mockValidPrisma();
      prisma.rentTimeUnit.findFirst.mockResolvedValue(null);
      mockReq.body = { ...validRentBody(), rentTimeUnitId: 999 };
      await run();
      expectRejected("invalidRentTimeUnitId");
    });

    it("Venta: rejects a rentPrice", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validSellBody(), rentPrice: 75 };
      await run();
      expectRejected("pricingMismatch");
    });

    it("Venta: rejects a rentTimeUnitId", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validSellBody(), rentTimeUnitId: 2 };
      await run();
      expectRejected("pricingMismatch");
    });

    it("Venta: rejects a missing sellPrice", async () => {
      const { sellPrice: _omit, ...body } = validSellBody();
      await mockValidPrisma();
      mockReq.body = body;
      await run();
      expectRejected("sellPricingRequired");
    });

    // ── Happy paths ───────────────────────────────────────────────────────────────────────────

    it("Alquiler: passes and sanitizes the body (truncated money, trimmed text, no sell fields)", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        name: "  Mesa redonda blanca  ",
        rentPrice: 75.999,
        replacementPrice: 900.555,
        productDetails: [{ detailTypeId: 1, detail: "  Blanco nieve  " }],
      };
      await run();

      expect(sendOzariError).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toEqual({
        businessTypeId: BusinessTypeEnum.RENT,
        categoryId: 1,
        currencyId: 1,
        description: "Mesa para 8 personas",
        name: "Mesa redonda blanca",
        productDetails: [{ detailTypeId: 1, detail: "Blanco nieve" }],
        quantity: 40,
        rentPrice: 75.99,
        rentTimeUnitId: 2,
        replacementPrice: 900.55,
        sellPrice: undefined,
      });
    });

    it("Venta: passes without rent fields and with an absent description/replacement", async () => {
      await mockValidPrisma();
      mockReq.body = validSellBody();
      await run();

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toEqual({
        businessTypeId: BusinessTypeEnum.SELL,
        categoryId: 1,
        currencyId: 1,
        description: undefined,
        name: "Vasos plásticos",
        productDetails: [],
        quantity: 100,
        rentPrice: undefined,
        rentTimeUnitId: undefined,
        replacementPrice: undefined,
        sellPrice: 12.5,
      });
    });

    it("sends a 500 when a lookup query throws", async () => {
      const { getPrismaClient } = await import("@/services/prisma.service.js");
      (getPrismaClient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
      mockReq.body = validRentBody();
      await run();

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.INTERNAL_SERVER_ERROR);
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
