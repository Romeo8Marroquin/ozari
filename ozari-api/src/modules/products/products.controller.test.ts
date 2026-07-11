import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import {
  createProduct,
  getProductCatalog,
  getProducts,
} from "./products.controller.js";
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

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariSuccessModel.js", () => ({ sendOzariSuccess: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));
vi.mock("@/config/auditLogger.js", () => ({
  AuditAction: { ADMIN_ACTION: "ADMIN_ACTION" },
  logAudit: vi.fn(),
}));
vi.mock("@/config/environment.js", () => ({ isDeployedEnvironment: vi.fn(() => false) }));

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
