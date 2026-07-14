import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import {
  createProduct,
  createProductImageUploads,
  getProductCatalog,
  getProducts,
} from "./products.controller.js";
import { getStorage, StorageValidationError } from "@helpers/storage.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import {
  type ProductCatalogResponseModel,
  type ProductListItemResponseModel,
  type ProductListResponseModel,
} from "./products.models.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariSuccessModel.js", () => ({ sendOzariSuccess: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));
vi.mock("@/config/auditLogger.js", () => ({
  AuditAction: { ADMIN_ACTION: "ADMIN_ACTION" },
  logAudit: vi.fn(),
}));
vi.mock("@/config/environment.js", () => ({ isDeployedEnvironment: vi.fn(() => false) }));
vi.mock("@helpers/storage.js", () => ({
  getStorage: vi.fn(),
  StorageValidationError: class StorageValidationError extends Error {},
}));

const rawProduct = {
  id: 7,
  name: "Mesa redonda",
  description: "Mesa para 8 personas",
  rentPrice: 75,
  sellPrice: null,
  replacementPrice: 900,
  quantity: 40,
  isActive: true,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: null,
  businessType: { name: "Alquiler" },
  category: { name: "Mesas" },
  currency: { id: 1, iso4217Code: "GTQ", name: "Quetzal Guatemalteco", symbol: "Q" },
  rentTimeUnit: { name: "Día" },
  productDetails: [{ id: 12, detail: "Blanco", detailType: { name: "Color" } }],
  productImages: [{ id: 1, url: "https://cdn.example.com/a.webp", isPrimary: true, sortOrder: 0 }],
};

function mockPrisma(products: unknown[] = [rawProduct], total = products.length) {
  const findMany = vi.fn().mockResolvedValue(products);
  const count = vi.fn().mockResolvedValue(total);
  (getPrismaClient as Mock).mockResolvedValue({ product: { findMany, count } });
  return { findMany, count };
}

const buildReq = (role: RolesEnum | undefined, query: Record<string, unknown> = {}): CustomRequest =>
  ({
    query,
    user: role === undefined ? undefined : { userRole: role, userId: 1 },
  }) as unknown as CustomRequest;

const successData = () =>
  (sendOzariSuccess as Mock).mock.calls[0]?.[3] as ProductListResponseModel;

beforeEach(() => vi.clearAllMocks());

describe("getProducts", () => {
  it("returns the Admin projection (exact stock + internal fields) with pagination", async () => {
    mockPrisma();
    await getProducts(buildReq(RolesEnum.Admin), {} as Response);

    const data = successData();
    expect(data.products).toHaveLength(1);
    expect(data.products[0]).toMatchObject({ id: 7, quantity: 40, replacementPrice: 900, inStock: true, isActive: true });
    expect(data.pagination).toEqual({ page: 1, pageSize: 15, total: 1, totalPages: 1 });
  });

  it("returns the Client projection (no stock information)", async () => {
    mockPrisma();
    await getProducts(buildReq(RolesEnum.Client), {} as Response);

    const item = successData().products[0]!;
    expect(item.name).toBe("Mesa redonda");
    expect(item.quantity).toBeUndefined();
    expect(item.inStock).toBeUndefined();
    expect(item.replacementPrice).toBeUndefined();
  });

  it("defaults to the least-privileged (Client) view when the role is somehow absent", async () => {
    mockPrisma();
    await getProducts(buildReq(undefined), {} as Response);
    expect(successData().products[0]!.quantity).toBeUndefined();
  });

  it("applies clamped pagination to the query (skip/take)", async () => {
    const { findMany } = mockPrisma([], 0);
    await getProducts(buildReq(RolesEnum.Employee, { page: "2", pageSize: "10" }), {} as Response);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    expect(successData().pagination).toEqual({ page: 2, pageSize: 10, total: 0, totalPages: 1 });
  });

  it("sends a 500 when the query fails", async () => {
    (getPrismaClient as Mock).mockRejectedValue(new Error("db down"));
    await getProducts(buildReq(RolesEnum.Admin), {} as Response);
    expect(sendOzariError).toHaveBeenCalled();
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });
});

const createBody = {
  businessTypeId: 1,
  categoryId: 1,
  currencyId: 1,
  description: "Mesa para 8 personas",
  images: [],
  name: "Mesa redonda",
  productDetails: [{ detailTypeId: 1, detail: "Blanco" }],
  quantity: 40,
  rentPrice: 75,
  rentTimeUnitId: 2,
  replacementPrice: 900,
  sellPrice: undefined,
};

const buildCreateReq = (
  body: Record<string, unknown> = createBody,
  role: RolesEnum | null = RolesEnum.Admin, // null = no authenticated user on the request
): CustomRequest =>
  ({
    body,
    ip: "127.0.0.1",
    user: role === null ? undefined : { userRole: role, userId: 1 },
  }) as unknown as CustomRequest;

describe("createProduct", () => {
  function mockCreate(created: unknown = rawProduct) {
    const create = vi.fn().mockResolvedValue(created);
    (getPrismaClient as Mock).mockResolvedValue({ product: { create } });
    return { create };
  }

  it("creates the product with nested details and responds 201 with the Admin projection", async () => {
    const { create } = mockCreate();
    await createProduct(buildCreateReq(), {} as Response);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Mesa redonda",
          productBusinessTypeId: 1,
          productCategoryId: 1,
          currencyId: 1,
          quantity: 40,
          rentPrice: 75,
          sellPrice: null,
          replacementPrice: 900,
          rentTimeUnitId: 2,
          productDetails: {
            create: [{ productDetailTypeId: 1, detail: "Blanco" }],
          },
        }),
      }),
    );

    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CREATED,
      "products.createProduct.productCreated",
      expect.objectContaining({ id: 7, quantity: 40, replacementPrice: 900, isActive: true }),
    );
  });

  it("nested-creates gallery images with server-derived URLs (never a client URL)", async () => {
    (getStorage as Mock).mockReturnValue({
      getPublicUrl: (key: string) => `https://cdn.test/${key}`,
    });
    const { create } = mockCreate();
    const key1 = "products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c01.webp";
    const key2 = "products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c02.jpg";
    await createProduct(
      buildCreateReq({
        ...createBody,
        images: [
          { key: key1, isPrimary: false },
          { key: key2, isPrimary: true },
        ],
      }),
      {} as Response,
    );

    const data = (create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data["productImages"]).toEqual({
      create: [
        { r2Key: key1, url: `https://cdn.test/${key1}`, isPrimary: false, sortOrder: 0 },
        { r2Key: key2, url: `https://cdn.test/${key2}`, isPrimary: true, sortOrder: 1 },
      ],
    });
  });

  it("never touches storage on an image-less create (works without the R2 env)", async () => {
    const { create } = mockCreate();
    await createProduct(buildCreateReq(), {} as Response);

    expect(getStorage).not.toHaveBeenCalled();
    const data = (create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("productImages");
  });

  it("omits the nested details create when the list is empty", async () => {
    const { create } = mockCreate();
    await createProduct(buildCreateReq({ ...createBody, productDetails: [] }), {} as Response);

    const data = (create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("productDetails");
  });

  it("projects fail-closed (minimum fields) if the role is somehow absent", async () => {
    mockCreate();
    await createProduct(buildCreateReq(createBody, null), {} as Response);

    const item = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as ProductListItemResponseModel;
    expect(item.quantity).toBeUndefined();
    expect(item.isActive).toBeUndefined();
  });

  it("audit-logs the creation only in deployed environments", async () => {
    mockCreate();
    await createProduct(buildCreateReq(), {} as Response);
    expect(logAudit).not.toHaveBeenCalled();

    (isDeployedEnvironment as Mock).mockReturnValue(true);
    mockCreate();
    await createProduct(buildCreateReq(), {} as Response);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ADMIN_ACTION",
        userId: 1,
        resource: "Product ID 7",
        success: true,
      }),
    );
    (isDeployedEnvironment as Mock).mockReturnValue(false);
  });

  it("sends a 500 when the insert fails", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      product: { create: vi.fn().mockRejectedValue(new Error("db down")) },
    });
    await createProduct(buildCreateReq(), {} as Response);
    expect(sendOzariError).toHaveBeenCalled();
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });

  it("maps the r2_key unique violation (P2002) to a clean 400, not a 500", async () => {
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test", meta: { target: ["r2_key"] } },
    );
    (getPrismaClient as Mock).mockResolvedValue({
      product: { create: vi.fn().mockRejectedValue(uniqueViolation) },
    });
    await createProduct(buildCreateReq(), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.BAD_REQUEST,
      "products.createProduct.validators.duplicateImageKey",
    );
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });
});

describe("createProductImageUploads", () => {
  const uploadsBody = {
    files: [
      { contentType: "image/webp", contentLength: 245760 },
      { contentType: "image/jpeg", contentLength: 1024 },
    ],
  };

  it("mints one presigned upload per file (kind: product) and responds 200 in order", async () => {
    const createUpload = vi
      .fn()
      .mockImplementation(({ contentType }: { contentType: string }) =>
        Promise.resolve({
          uploadUrl: `https://r2.test/put/${contentType}`,
          key: `products/key-${contentType}`,
          publicUrl: `https://cdn.test/${contentType}`,
        }),
      );
    (getStorage as Mock).mockReturnValue({ createUpload });

    await createProductImageUploads(buildCreateReq(uploadsBody), {} as Response);

    expect(createUpload).toHaveBeenCalledTimes(2);
    expect(createUpload).toHaveBeenCalledWith({
      kind: "product",
      contentType: "image/webp",
      contentLength: 245760,
    });
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "products.imageUploads.uploadsCreated",
      {
        uploads: [
          expect.objectContaining({ key: "products/key-image/webp" }),
          expect.objectContaining({ key: "products/key-image/jpeg" }),
        ],
      },
    );
  });

  it("maps a StorageValidationError to a clean 400 (policy drift, not a crash)", async () => {
    (getStorage as Mock).mockReturnValue({
      createUpload: vi.fn().mockRejectedValue(new StorageValidationError("bad type")),
    });

    await createProductImageUploads(buildCreateReq(uploadsBody), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.BAD_REQUEST,
      "products.imageUploads.validators.invalidFiles",
    );
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });

  it("sends a 500 when the storage client fails", async () => {
    (getStorage as Mock).mockReturnValue({
      createUpload: vi.fn().mockRejectedValue(new Error("r2 down")),
    });

    await createProductImageUploads(buildCreateReq(uploadsBody), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "products.imageUploads.errorCreatingUploads",
    );
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });
});

describe("getProductCatalog", () => {
  it("returns the five active reference lists", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      productBusinessType: { findMany: vi.fn().mockResolvedValue([{ id: 1, name: "Alquiler" }]) },
      productCategory: { findMany: vi.fn().mockResolvedValue([{ id: 1, name: "Mesas" }]) },
      currency: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, name: "Quetzal Guatemalteco", iso4217Code: "GTQ", symbol: "Q" },
        ]),
      },
      productDetailType: { findMany: vi.fn().mockResolvedValue([{ id: 1, name: "Color" }]) },
      rentTimeUnit: { findMany: vi.fn().mockResolvedValue([{ id: 2, name: "Día" }]) },
    });

    await getProductCatalog({} as CustomRequest, {} as Response);

    const data = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as ProductCatalogResponseModel;
    expect(data).toEqual({
      businessTypes: [{ id: 1, name: "Alquiler" }],
      categories: [{ id: 1, name: "Mesas" }],
      currencies: [{ id: 1, name: "Quetzal Guatemalteco", iso4217Code: "GTQ", symbol: "Q" }],
      detailTypes: [{ id: 1, name: "Color" }],
      rentTimeUnits: [{ id: 2, name: "Día" }],
    });
  });

  it("sends a 500 when a lookup query fails", async () => {
    (getPrismaClient as Mock).mockRejectedValue(new Error("db down"));
    await getProductCatalog({} as CustomRequest, {} as Response);
    expect(sendOzariError).toHaveBeenCalled();
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });
});
