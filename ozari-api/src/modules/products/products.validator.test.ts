import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  validateCreateProduct,
  validateCreateProductImageUploads,
  validateDeleteProduct,
  validateUpdateProduct,
  validateUpdateProductDisplayOrder,
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
    maxArrangedProducts: 3,
    maxProductOptions: 3,
    maxOptionValues: 20,
    maxProductVariants: 60,
    storage: {
      maxUploadBytes: 5 * 1024 * 1024,
      maxImagesPerProduct: 10,
      maxImagesPerOptionValue: 6,
      maxImagesTotalPerProduct: 150,
      allowedImageTypes: {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/avif": "avif",
      },
      keyPrefixes: { product: "products" },
    },
  },
}));

/** A key exactly as the upload-url endpoint mints them (uuid v4 + whitelisted extension). */
const mintedKey = (n: number, ext = "webp") =>
  `products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c0${n}.${ext}`;

/** Prisma with every lookup VALID — individual tests override the piece they need to fail. */
const mockValidPrisma = async () => {
  const prisma = {
    productCategory: { findFirst: vi.fn().mockResolvedValue({ id: 1, isActive: true }) },
    currency: { findFirst: vi.fn().mockResolvedValue({ id: 1, isActive: true }) },
    productDetailType: { findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]) },
    rentTimeUnit: { findFirst: vi.fn().mockResolvedValue({ id: 2, isActive: true }) },
    // The update validator's target product, WITH its active rows (ownership checks read them).
    product: {
      findFirst: vi.fn().mockResolvedValue({
        id: 1,
        productImages: [{ id: 11 }, { id: 12 }],
        productDetails: [{ id: 21 }, { id: 22 }],
        options: [],
        variants: [],
      }),
    },
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

    it("should reject two details of the same type (one per type)", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        productDetails: [
          { detailTypeId: 1, detail: "Blanco nieve" },
          { detailTypeId: 1, detail: "Negro mate ok" },
        ],
      };
      await run();
      expectRejected("duplicateDetailType");
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

    it("should reject a non-integer quantity", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validRentBody(), quantity: 3.5 };
      await run();
      expectRejected("invalidQuantity");
    });

    // ── Gallery images ────────────────────────────────────────────────────────────────────────

    it("should reject a non-array images value", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validRentBody(), images: "products/x.webp" };
      await run();
      expectRejected("invalidImages");
    });

    it("should reject more images than the gallery cap", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        images: Array.from({ length: 11 }, (_, i) => ({ key: mintedKey(i) })),
      };
      await run();
      expectRejected("tooManyImages");
    });

    it("should reject a key that our presign flow could not have minted", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        images: [{ key: "products/../users/1.webp" }],
      };
      await run();
      expectRejected("invalidImageKey");
    });

    it("should reject a key with a non-whitelisted extension", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        images: [{ key: mintedKey(1, "svg") }],
      };
      await run();
      expectRejected("invalidImageKey");
    });

    it("should reject a duplicated key", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        images: [{ key: mintedKey(1) }, { key: mintedKey(1) }],
      };
      await run();
      expectRejected("duplicateImageKey");
    });

    it("should reject more than one primary image", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        images: [
          { key: mintedKey(1), isPrimary: true },
          { key: mintedKey(2), isPrimary: true },
        ],
      };
      await run();
      expectRejected("multiplePrimaryImages");
    });

    it("defaults the FIRST image to primary when none is flagged", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        images: [{ key: mintedKey(1) }, { key: mintedKey(2) }],
      };
      await run();

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq.body as { images: unknown }).images).toEqual([
        { key: mintedKey(1), isPrimary: true },
        { key: mintedKey(2), isPrimary: false },
      ]);
    });

    it("honours an explicit primary flag on a non-first image", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        images: [{ key: mintedKey(1) }, { key: mintedKey(2), isPrimary: true }],
      };
      await run();

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq.body as { images: unknown }).images).toEqual([
        { key: mintedKey(1), isPrimary: false },
        { key: mintedKey(2), isPrimary: true },
      ]);
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

    it("Venta: rejects a replacementPrice (a sold item is consumed — nothing to replace)", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validSellBody(), replacementPrice: 900 };
      await run();
      expectRejected("replacementPriceForbidden");
    });

    // ── The security-deposit rule ─────────────────────────────────────────────────────────────

    it.each([
      ["an invalid deposit", { ...validRentBody(), securityDeposit: -5 }, "invalidSecurityDeposit"],
      ["a deposit on a Venta product", { ...validSellBody(), securityDeposit: 50 }, "securityDepositForbidden"],
      [
        "a deposit above the replacement price",
        { ...validRentBody(), replacementPrice: 900, securityDeposit: 900.01 },
        "securityDepositAboveReplacement",
      ],
    ])("rejects %s", async (_label, body, key) => {
      await mockValidPrisma();
      mockReq.body = body;
      await run();
      expectRejected(key);
    });

    it("accepts a deposit equal to the replacement price, or without one", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validRentBody(), replacementPrice: 900, securityDeposit: 900 };
      await run();
      expect((mockReq.body as { securityDeposit: number }).securityDeposit).toBe(900);

      mockReq.body = { ...validRentBody(), replacementPrice: undefined, securityDeposit: 250.559 };
      await run();
      expect((mockReq.body as { securityDeposit: number }).securityDeposit).toBe(250.55);
      expect(sendOzariError).not.toHaveBeenCalled();
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
        images: [],
        name: "Mesa redonda blanca",
        productDetails: [{ detailTypeId: 1, detail: "Blanco nieve" }],
        quantity: 40,
        rentPrice: 75.99,
        rentTimeUnitId: 2,
        replacementPrice: 900.55,
        securityDeposit: undefined,
        sellPrice: undefined,
        options: [],
        variants: [],
        sharedStock: false,
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
        images: [],
        name: "Vasos plásticos",
        productDetails: [],
        quantity: 100,
        rentPrice: undefined,
        rentTimeUnitId: undefined,
        replacementPrice: undefined,
        securityDeposit: undefined,
        sellPrice: 12.5,
        options: [],
        variants: [],
        sharedStock: false,
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

    // ── Variations (the shared parser, wired into the create door) ────────────────────────────

    const colorOptions = [{ name: "Color", values: [{ key: "r", name: "Rojo" }] }];

    it("resolves the product quantity to 0 when variations carry the stock", async () => {
      await mockValidPrisma();
      const { quantity: _omit, ...body } = validRentBody();
      mockReq.body = {
        ...body,
        options: colorOptions,
        variants: [{ valueKeys: ["r"], quantity: 6, isDefault: true }],
      };
      await run();

      expect(sendOzariError).not.toHaveBeenCalled();
      expect(mockReq.body).toMatchObject({
        quantity: 0,
        options: [{ name: "Color", values: [{ key: "r", name: "Rojo", images: [] }] }],
        variants: [{ valueKeys: ["r"], quantity: 6, isDefault: true }],
      });
    });

    it("rejects a product quantity sent alongside variations (variation namespace)", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        options: colorOptions,
        variants: [{ valueKeys: ["r"], quantity: 6 }],
      };
      await run();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
      expect(lastErrorKey()).toBe("products.variations.validators.quantityWithVariants");
    });

    it("still requires the product quantity when there are no variations", async () => {
      await mockValidPrisma();
      const { quantity: _omit, ...body } = validRentBody();
      mockReq.body = body;
      await run();
      expectRejected("invalidQuantity");
    });

    it("SHARED stock keeps (and requires) the product quantity; the variants carry none", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validRentBody(),
        sharedStock: true,
        options: colorOptions,
        variants: [{ valueKeys: ["r"] }],
      };
      await run();
      expect(sendOzariError).not.toHaveBeenCalled();
      expect(mockReq.body).toMatchObject({
        quantity: 40,
        sharedStock: true,
        variants: [{ valueKeys: ["r"], quantity: 0 }],
      });

      vi.clearAllMocks();
      await mockValidPrisma();
      const { quantity: _omit, ...body } = validRentBody();
      mockReq.body = { ...body, sharedStock: true, options: colorOptions, variants: [{ valueKeys: ["r"] }] };
      await run();
      expectRejected("invalidQuantity");
    });

    it("makes the product price a DEFAULT with variations: absent is fine while every variant has one", async () => {
      await mockValidPrisma();
      const { quantity: _q, rentPrice: _r, ...body } = validRentBody();
      mockReq.body = {
        ...body,
        options: colorOptions,
        variants: [{ valueKeys: ["r"], quantity: 2, rentPrice: 60 }],
      };
      await run();
      expect(sendOzariError).not.toHaveBeenCalled();
      expect(mockReq.body).toMatchObject({ rentPrice: undefined, variants: [{ rentPrice: 60 }] });

      vi.clearAllMocks();
      await mockValidPrisma();
      mockReq.body = { ...body, options: colorOptions, variants: [{ valueKeys: ["r"], quantity: 2 }] };
      await run();
      expect(lastErrorKey()).toBe("products.variations.validators.variantPriceRequired");

      // Venta the same way (its sellPrice is the default).
      vi.clearAllMocks();
      await mockValidPrisma();
      const { quantity: _sq, sellPrice: _s, ...sale } = validSellBody();
      mockReq.body = {
        ...sale,
        options: colorOptions,
        variants: [{ valueKeys: ["r"], quantity: 2, sellPrice: 9 }],
      };
      await run();
      expect(sendOzariError).not.toHaveBeenCalled();
    });

    it("forbids ids on create (the parser runs with no existing state)", async () => {
      await mockValidPrisma();
      const { quantity: _omit, ...body } = validRentBody();
      mockReq.body = {
        ...body,
        options: [{ id: 3, name: "Color", values: [{ key: "r", name: "Rojo" }] }],
        variants: [{ valueKeys: ["r"], quantity: 1 }],
      };
      await run();
      expect(lastErrorKey()).toBe("products.variations.validators.idsForbiddenOnCreate");
    });
  });

  describe("validateUpdateProductDisplayOrder", () => {
    const runOrder = () =>
      validateUpdateProductDisplayOrder(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

    it("passes a list of distinct positive integers through, reshaped to exactly that field", () => {
      mockReq.body = { productIds: [3, 1, 2], extra: "dropped" };
      runOrder();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toEqual({ productIds: [3, 1, 2] });
    });

    it.each([
      ["a missing body", undefined],
      ["a missing list", {}],
      ["a non-array", { productIds: "1,2" }],
      ["an empty list", { productIds: [] }],
      ["more ids than the cap", { productIds: [1, 2, 3, 4] }],
      ["a duplicate", { productIds: [1, 1] }],
      ["a zero", { productIds: [0, 1] }],
      ["a fraction", { productIds: [1.5] }],
      ["a numeric string", { productIds: ["2"] }],
    ])("rejects %s with a 400", (_label, body) => {
      mockReq.body = body;
      runOrder();
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
      expect(lastErrorKey()).toBe("products.displayOrder.validators.invalidProductIds");
    });
  });

  describe("validateCreateProductImageUploads", () => {
    const runUploads = () =>
      validateCreateProductImageUploads(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );

    const expectUploadsRejected = (key: string) => {
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
      expect(lastErrorKey()).toBe(`products.imageUploads.validators.${key}`);
    };

    it("should reject a missing files array", () => {
      mockReq.body = {};
      runUploads();
      expectUploadsRejected("invalidFiles");
    });

    it("should reject an empty files array", () => {
      mockReq.body = { files: [] };
      runUploads();
      expectUploadsRejected("invalidFiles");
    });

    it("should reject more files than the product's TOTAL photo cap (showcase + every value set)", () => {
      mockReq.body = {
        files: Array.from({ length: 151 }, () => ({
          contentType: "image/webp",
          contentLength: 1024,
        })),
      };
      runUploads();
      expectUploadsRejected("tooManyFiles");
    });

    it("should reject a non-whitelisted content type", () => {
      mockReq.body = {
        files: [{ contentType: "image/svg+xml", contentLength: 1024 }],
      };
      runUploads();
      expectUploadsRejected("invalidContentType");
    });

    it("should reject an oversized file", () => {
      mockReq.body = {
        files: [{ contentType: "image/webp", contentLength: 5 * 1024 * 1024 + 1 }],
      };
      runUploads();
      expectUploadsRejected("invalidContentLength");
    });

    it("should reject a non-integer content length", () => {
      mockReq.body = {
        files: [{ contentType: "image/png", contentLength: 10.5 }],
      };
      runUploads();
      expectUploadsRejected("invalidContentLength");
    });

    it("should reject a zero/negative content length", () => {
      mockReq.body = {
        files: [{ contentType: "image/png", contentLength: 0 }],
      };
      runUploads();
      expectUploadsRejected("invalidContentLength");
    });

    it("passes a valid request and strips unknown fields", () => {
      mockReq.body = {
        files: [
          { contentType: "image/webp", contentLength: 245760, extra: "ignored" },
          { contentType: "image/jpeg", contentLength: 1024 },
        ],
        extraTop: "ignored",
      };
      runUploads();

      expect(sendOzariError).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toEqual({
        files: [
          { contentType: "image/webp", contentLength: 245760 },
          { contentType: "image/jpeg", contentLength: 1024 },
        ],
      });
    });

    it("sends a 500 when reading the body throws", () => {
      const throwingReq = {} as Request;
      Object.defineProperty(throwingReq, "body", {
        get() {
          throw new Error("boom");
        },
      });
      validateCreateProductImageUploads(
        throwingReq,
        mockRes as Response,
        mockNext as NextFunction,
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.INTERNAL_SERVER_ERROR);
    });
  });

  describe("validateUpdateProduct", () => {
    /** A valid full-state Alquiler update: one kept image + one new key, one kept + one new detail. */
    const validUpdateBody = () => ({
      ...validRentBody(),
      productDetails: [
        { id: 21, detailTypeId: 1, detail: "Blanco nieve" },
        { detailTypeId: 2, detail: "Madera de pino" },
      ],
      images: [{ id: 11, isPrimary: true }, { key: mintedKey(1) }],
    });

    const runUpdate = async (id: string | undefined = "1") => {
      mockReq.params = id === undefined ? {} : { id };
      return validateUpdateProduct(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );
    };

    const expectUpdateRejected = (key: string) => {
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.BAD_REQUEST);
      expect(lastErrorKey()).toBe(`products.updateProduct.validators.${key}`);
    };

    describe("variations (the product's current ids are the parser's `existing`)", () => {
      const withColor = async () => {
        const prisma = await mockValidPrisma();
        prisma.product.findFirst.mockResolvedValue({
          id: 1,
          productImages: [{ id: 11 }, { id: 12 }, { id: 13 }],
          productDetails: [{ id: 21 }, { id: 22 }],
          options: [{ id: 3, values: [{ id: 10 }] }],
          variants: [{ id: 55 }],
        });
      };
      const variationBody = (values: unknown[], variants: unknown[]) => {
        const { quantity: _omit, ...body } = validUpdateBody();
        return { ...body, options: [{ id: 3, name: "Color", values }], variants };
      };

      it("keeps the product's own option, value, photo (moved into a value set) and active variant", async () => {
        await withColor();
        mockReq.body = variationBody(
          [{ id: 10, key: "v10", name: "Rojo", images: [{ id: 13 }] }],
          [{ id: 55, valueKeys: ["v10"], quantity: 2 }],
        );
        await runUpdate();
        expect(sendOzariError).not.toHaveBeenCalled();
        expect(mockReq.body).toMatchObject({
          quantity: 0,
          options: [{ id: 3, values: [{ id: 10, images: [{ id: 13, isPrimary: true }] }] }],
          variants: [{ id: 55 }],
        });
      });

      it("rejects a value id from another product and a variant that is not active here", async () => {
        await withColor();
        mockReq.body = variationBody([{ id: 99, key: "v99", name: "Rojo" }], []);
        await runUpdate();
        expect(lastErrorKey()).toBe("products.variations.validators.invalidValueId");

        vi.clearAllMocks();
        await withColor();
        mockReq.body = variationBody(
          [{ id: 10, key: "v10", name: "Rojo" }],
          [{ id: 57, valueKeys: ["v10"], quantity: 2 }],
        );
        await runUpdate();
        expect(lastErrorKey()).toBe("products.variations.validators.invalidVariantId");
      });

      it("takes a product without its own price once variations price themselves (both types)", async () => {
        await withColor();
        const { rentPrice: _r, ...rent } = variationBody(
          [{ id: 10, key: "v10", name: "Rojo" }],
          [{ id: 55, valueKeys: ["v10"], quantity: 2, rentPrice: 80 }],
        );
        mockReq.body = rent;
        await runUpdate();
        expect(sendOzariError).not.toHaveBeenCalled();
        expect(mockReq.body).toMatchObject({ rentPrice: undefined, sharedStock: false });

        vi.clearAllMocks();
        await withColor();
        const { quantity: _q, sellPrice: _s, ...sale } = validSellBody();
        mockReq.body = {
          ...sale,
          options: [{ id: 3, name: "Color", values: [{ id: 10, key: "v10", name: "Rojo" }] }],
          variants: [{ id: 55, valueKeys: ["v10"], quantity: 2, sellPrice: 9 }],
        };
        await runUpdate();
        expect(sendOzariError).not.toHaveBeenCalled();
        expect(mockReq.body).toMatchObject({ sellPrice: undefined, variants: [{ sellPrice: 9 }] });
      });
    });

    it("passes a valid full-state body through, sanitized", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), name: "  Mesa redonda blanca  " };
      await runUpdate();

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toEqual({
        businessTypeId: BusinessTypeEnum.RENT,
        categoryId: 1,
        currencyId: 1,
        description: "Mesa para 8 personas",
        images: [
          { id: 11, isPrimary: true },
          { key: mintedKey(1), isPrimary: false },
        ],
        name: "Mesa redonda blanca",
        productDetails: [
          { id: 21, detailTypeId: 1, detail: "Blanco nieve" },
          { detailTypeId: 2, detail: "Madera de pino" },
        ],
        quantity: 40,
        rentPrice: 75,
        rentTimeUnitId: 2,
        replacementPrice: 900,
        securityDeposit: undefined,
        sellPrice: undefined,
        options: [],
        variants: [],
        sharedStock: false,
      });
    });

    it("404s a malformed id (nothing for the client to fix — the getProductById stance)", async () => {
      await mockValidPrisma();
      mockReq.body = validUpdateBody();
      await runUpdate("abc");

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.NOT_FOUND);
      expect(lastErrorKey()).toBe("products.updateProduct.validators.productNotFound");
    });

    it("404s an unknown or soft-deleted product", async () => {
      const prisma = await mockValidPrisma();
      prisma.product.findFirst.mockResolvedValue(null);
      mockReq.body = validUpdateBody();
      await runUpdate("999");

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.NOT_FOUND);
      expect(lastErrorKey()).toBe("products.updateProduct.validators.productNotFound");
    });

    it("enforces the shared create rules (business type, pricing) on the NEW state", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), businessTypeId: 999 };
      await runUpdate();
      expectRejected("invalidBusinessTypeId");

      vi.clearAllMocks();
      await mockValidPrisma();
      // Switching to Venta must arrive in the Venta shape — rent leftovers are a mismatch.
      mockReq.body = { ...validUpdateBody(), businessTypeId: BusinessTypeEnum.SELL, sellPrice: 10 };
      await runUpdate();
      expectRejected("pricingMismatch");
    });

    it("enforces the shared security-deposit rule, and carries a valid deposit through", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), securityDeposit: "mucho" };
      await runUpdate();
      expectRejected("invalidSecurityDeposit");

      vi.clearAllMocks();
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), securityDeposit: 901 };
      await runUpdate();
      expectRejected("securityDepositAboveReplacement");

      vi.clearAllMocks();
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), securityDeposit: 300 };
      await runUpdate();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toMatchObject({ securityDeposit: 300, replacementPrice: 900 });
    });

    it("rejects a detail id that doesn't belong to the product", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validUpdateBody(),
        productDetails: [{ id: 999, detailTypeId: 1, detail: "Blanco nieve" }],
      };
      await runUpdate();
      expectUpdateRejected("invalidDetailId");
    });

    it("rejects a repeated detail id (one row can't be kept twice)", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validUpdateBody(),
        productDetails: [
          { id: 21, detailTypeId: 1, detail: "Blanco nieve" },
          { id: 21, detailTypeId: 2, detail: "Madera de pino" },
        ],
      };
      await runUpdate();
      expectUpdateRejected("invalidDetailId");
    });

    it("still rejects a duplicate detail TYPE across kept + new rows", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validUpdateBody(),
        productDetails: [
          { id: 21, detailTypeId: 1, detail: "Blanco nieve" },
          { detailTypeId: 1, detail: "Blanco perla" },
        ],
      };
      await runUpdate();
      expectRejected("duplicateDetailType");
    });

    it("rejects a gallery slot carrying BOTH id and key, or neither", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), images: [{ id: 11, key: mintedKey(1) }] };
      await runUpdate();
      expectUpdateRejected("invalidImageEntry");

      vi.clearAllMocks();
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), images: [{ isPrimary: true }] };
      await runUpdate();
      expectUpdateRejected("invalidImageEntry");
    });

    it("rejects an image id that doesn't belong to the product, and a repeated one", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), images: [{ id: 999 }] };
      await runUpdate();
      expectUpdateRejected("invalidImageId");

      vi.clearAllMocks();
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), images: [{ id: 11 }, { id: 11 }] };
      await runUpdate();
      expectUpdateRejected("invalidImageId");
    });

    it("applies the create-side key rules (shape, duplicates, cap, one primary)", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), images: [{ key: "evil/../escape.webp" }] };
      await runUpdate();
      expectRejected("invalidImageKey");

      vi.clearAllMocks();
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), images: [{ key: mintedKey(1) }, { key: mintedKey(1) }] };
      await runUpdate();
      expectRejected("duplicateImageKey");

      vi.clearAllMocks();
      await mockValidPrisma();
      mockReq.body = {
        ...validUpdateBody(),
        images: Array.from({ length: 11 }, (_, i) => ({ key: mintedKey(i) })),
      };
      await runUpdate();
      expectRejected("tooManyImages");

      vi.clearAllMocks();
      await mockValidPrisma();
      mockReq.body = {
        ...validUpdateBody(),
        images: [
          { id: 11, isPrimary: true },
          { id: 12, isPrimary: true },
        ],
      };
      await runUpdate();
      expectRejected("multiplePrimaryImages");

      vi.clearAllMocks();
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), images: "nope" };
      await runUpdate();
      expectRejected("invalidImages");
    });

    it("defaults the primary to the FIRST slot when none is flagged", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), images: [{ id: 12 }, { id: 11 }] };
      await runUpdate();

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq.body as { images: unknown }).images).toEqual([
        { id: 12, isPrimary: true },
        { id: 11, isPrimary: false },
      ]);
    });

    it("accepts an empty gallery and empty details (delete everything declaratively)", async () => {
      await mockValidPrisma();
      mockReq.body = { ...validUpdateBody(), images: [], productDetails: [] };
      await runUpdate();

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toMatchObject({ images: [], productDetails: [] });
    });

    it("validates the Venta shape end-to-end (sell only, no rent leftovers)", async () => {
      await mockValidPrisma();
      mockReq.body = {
        ...validSellBody(),
        images: [],
        productDetails: [],
      };
      await runUpdate();

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toMatchObject({
        businessTypeId: BusinessTypeEnum.SELL,
        sellPrice: 12.5,
        rentPrice: undefined,
        rentTimeUnitId: undefined,
        replacementPrice: undefined,
      });
    });

    it("maps an unexpected throw to a clean 500", async () => {
      const { getPrismaClient } = await import("@/services/prisma.service.js");
      (getPrismaClient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
      mockReq.body = validUpdateBody();
      await runUpdate();

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.INTERNAL_SERVER_ERROR);
    });
  });

  describe("validateDeleteProduct", () => {
    const runDelete = async (id: string) => {
      mockReq.params = { id };
      return validateDeleteProduct(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction,
      );
    };

    it("passes an existing active product through", async () => {
      await mockValidPrisma();
      await runDelete("1");
      expect(mockNext).toHaveBeenCalled();
    });

    it("404s malformed and unknown ids alike (nothing for the client to fix)", async () => {
      await mockValidPrisma();
      await runDelete("abc");
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.NOT_FOUND);
      expect(lastErrorKey()).toBe("products.deleteProduct.validators.productNotFound");

      vi.clearAllMocks();
      const prisma = await mockValidPrisma();
      prisma.product.findFirst.mockResolvedValue(null);
      await runDelete("999");
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.NOT_FOUND);
    });

    it("maps an unexpected throw to a clean 500", async () => {
      const { getPrismaClient } = await import("@/services/prisma.service.js");
      (getPrismaClient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
      await runDelete("1");
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(HttpEnum.INTERNAL_SERVER_ERROR);
    });
  });
});
