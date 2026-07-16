import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import {
  createProduct,
  createProductImageUploads,
  deleteProduct,
  getProductById,
  getProductCatalog,
  getProducts,
  updateProduct,
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
  productBusinessTypeId: 1, // Alquiler — availability is DERIVED for this row
  productCategoryId: 1,
  currencyId: 1,
  rentTimeUnitId: 2,
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

/** One rented-now grouped row, as `serviceDetail.groupBy` returns it. */
const rentedRow = (productId: number, rented: number | null) => ({
  productId,
  _sum: { quantity: rented },
});

function mockPrisma(
  products: unknown[] = [rawProduct],
  total = products.length,
  rented: ReturnType<typeof rentedRow>[] = [],
) {
  const findMany = vi.fn().mockResolvedValue(products);
  const count = vi.fn().mockResolvedValue(total);
  const groupBy = vi.fn().mockResolvedValue(rented);
  (getPrismaClient as Mock).mockResolvedValue({
    product: { findMany, count },
    serviceDetail: { groupBy },
  });
  return { findMany, count, groupBy };
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
  it("returns the Admin projection (available + fleet total + internal fields) with pagination", async () => {
    mockPrisma();
    await getProducts(buildReq(RolesEnum.Admin), {} as Response);

    const data = successData();
    expect(data.products).toHaveLength(1);
    expect(data.products[0]).toMatchObject({ id: 7, available: 40, total: 40, replacementPrice: 900, inStock: true, isActive: true });
    expect(data.pagination).toEqual({ page: 1, pageSize: 15, total: 1, totalPages: 1 });
  });

  it("subtracts the units out on active rentals from `available` (fleet `total` untouched)", async () => {
    const { groupBy } = mockPrisma([rawProduct], 1, [rentedRow(7, 15)]);
    await getProducts(buildReq(RolesEnum.Admin), {} as Response);

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["productId"],
        where: expect.objectContaining({ productId: { in: [7] } }),
        _sum: { quantity: true },
      }),
    );
    expect(successData().products[0]).toMatchObject({ available: 25, total: 40, inStock: true });
  });

  it("defaults a null grouped sum to 0 rented (nothing subtracted)", async () => {
    mockPrisma([rawProduct], 1, [rentedRow(7, null)]);
    await getProducts(buildReq(RolesEnum.Employee), {} as Response);
    expect(successData().products[0]).toMatchObject({ available: 40 });
  });

  it("never queries rentals for a Venta-only page (its quantity IS the availability)", async () => {
    const venta = { ...rawProduct, productBusinessTypeId: 2, businessType: { name: "Venta" } };
    const { groupBy } = mockPrisma([venta], 1, [rentedRow(7, 15)]);
    await getProducts(buildReq(RolesEnum.Admin), {} as Response);

    expect(groupBy).not.toHaveBeenCalled();
    const item = successData().products[0]!;
    expect(item.available).toBe(40);
    expect(item.total).toBeUndefined(); // fleet total is an Alquiler concept
  });

  it("returns the Client projection (no stock information)", async () => {
    mockPrisma();
    await getProducts(buildReq(RolesEnum.Client), {} as Response);

    const item = successData().products[0]!;
    expect(item.name).toBe("Mesa redonda");
    expect(item.available).toBeUndefined();
    expect(item.total).toBeUndefined();
    expect(item.inStock).toBeUndefined();
    expect(item.replacementPrice).toBeUndefined();
  });

  it("defaults to the least-privileged (Client) view when the role is somehow absent", async () => {
    mockPrisma();
    await getProducts(buildReq(undefined), {} as Response);
    expect(successData().products[0]!.available).toBeUndefined();
  });

  it("applies clamped pagination to the query (skip/take)", async () => {
    const { findMany } = mockPrisma([], 0);
    await getProducts(buildReq(RolesEnum.Employee, { page: "2", pageSize: "10" }), {} as Response);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    expect(successData().pagination).toEqual({ page: 2, pageSize: 10, total: 0, totalPages: 1 });
  });

  it("passes the parsed filters through to the where clause (findMany AND count)", async () => {
    const { findMany, count } = mockPrisma([], 0);
    await getProducts(
      buildReq(RolesEnum.Employee, {
        search: " mesa ",
        categoryId: "3",
        businessTypeId: "1",
      }),
      {} as Response,
    );
    const expectedWhere = expect.objectContaining({
      isActive: true,
      name: { contains: "mesa", mode: "insensitive" },
      productCategoryId: 3,
      productBusinessTypeId: 1,
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it("ignores the role-gated includeInactive for a Client (no inactive rows)", async () => {
    const { findMany } = mockPrisma([], 0);
    await getProducts(
      buildReq(RolesEnum.Client, { includeInactive: "true" }),
      {} as Response,
    );
    const where = (findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where["isActive"]).toBe(true);
  });

  it("serves a non-default sort via the id-page path: minimal fetch → order → rich page fetch", async () => {
    const second = { ...rawProduct, id: 8, rentPrice: 30 };
    // First findMany = the minimal sort fetch (whole filtered set); second = the rich page by ids.
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 7, name: "Mesa redonda", rentPrice: 75, sellPrice: null, createdAt: rawProduct.createdAt },
        { id: 8, name: "Mesa chica", rentPrice: 30, sellPrice: null, createdAt: rawProduct.createdAt },
      ])
      .mockResolvedValueOnce([rawProduct, second]); // DB returns them in ITS order — we must reorder
    const count = vi.fn();
    const groupBy = vi.fn().mockResolvedValue([]);
    (getPrismaClient as Mock).mockResolvedValue({
      product: { findMany, count },
      serviceDetail: { groupBy },
    });

    await getProducts(buildReq(RolesEnum.Client, { sort: "priceAsc" }), {} as Response);

    // The minimal fetch selects only the sort columns; the count query is skipped (the set IS the count).
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ select: expect.objectContaining({ id: true, rentPrice: true }) }),
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ id: { in: [8, 7] } }) }),
    );
    expect(count).not.toHaveBeenCalled();

    const data = successData();
    expect(data.products.map((product) => product.id)).toEqual([8, 7]); // cheapest first
    expect(data.pagination).toMatchObject({ total: 2 });
  });

  it("skips the rich fetch entirely for an out-of-range sorted page", async () => {
    const findMany = vi.fn().mockResolvedValueOnce([]); // empty filtered set
    (getPrismaClient as Mock).mockResolvedValue({
      product: { findMany, count: vi.fn() },
      serviceDetail: { groupBy: vi.fn().mockResolvedValue([]) },
    });
    await getProducts(buildReq(RolesEnum.Client, { sort: "nameAsc" }), {} as Response);

    expect(findMany).toHaveBeenCalledTimes(1); // no page ids → no second query
    expect(successData().products).toEqual([]);
    expect(successData().pagination).toMatchObject({ total: 0, totalPages: 1 });
  });

  it("widens to inactive rows for an Admin sending includeInactive", async () => {
    const { findMany } = mockPrisma([], 0);
    await getProducts(buildReq(RolesEnum.Admin, { includeInactive: "true" }), {} as Response);
    const where = (findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where["isActive"]).toBeUndefined();
  });

  it("sends a 500 when the query fails", async () => {
    (getPrismaClient as Mock).mockRejectedValue(new Error("db down"));
    await getProducts(buildReq(RolesEnum.Admin), {} as Response);
    expect(sendOzariError).toHaveBeenCalled();
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });
});

describe("getProductById", () => {
  const buildDetailReq = (
    role: RolesEnum | undefined,
    id: unknown,
  ): CustomRequest =>
    ({
      params: { id },
      user: role === undefined ? undefined : { userRole: role, userId: 1 },
    }) as unknown as CustomRequest;

  function mockDetailPrisma(
    product: unknown,
    rented: ReturnType<typeof rentedRow>[] = [],
  ) {
    const findFirst = vi.fn().mockResolvedValue(product);
    const groupBy = vi.fn().mockResolvedValue(rented);
    (getPrismaClient as Mock).mockResolvedValue({
      product: { findFirst },
      serviceDetail: { groupBy },
    });
    return { findFirst, groupBy };
  }

  it("returns the role-projected product (Admin view) for a valid id", async () => {
    const { findFirst } = mockDetailPrisma(rawProduct);
    await getProductById(buildDetailReq(RolesEnum.Admin, "7"), {} as Response);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 7, isActive: true }),
      }),
    );
    const data = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as { product: Record<string, unknown> };
    expect(data.product).toMatchObject({ id: 7, available: 40, total: 40, replacementPrice: 900, isActive: true });
  });

  it("derives the detail's availability from active rentals too", async () => {
    mockDetailPrisma(rawProduct, [rentedRow(7, 38)]);
    await getProductById(buildDetailReq(RolesEnum.Employee, "7"), {} as Response);
    const data = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as { product: Record<string, unknown> };
    expect(data.product).toMatchObject({ available: 2, inStock: true });
    expect(data.product["total"]).toBeUndefined(); // Employee never sees the fleet
  });

  it("projects minimally for a Client (and when the role is somehow absent)", async () => {
    mockDetailPrisma(rawProduct);
    await getProductById(buildDetailReq(undefined, "7"), {} as Response);
    const data = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as { product: Record<string, unknown> };
    expect(data.product["available"]).toBeUndefined();
    expect(data.product["inStock"]).toBeUndefined();
  });

  it("404s an unknown id", async () => {
    mockDetailPrisma(null);
    await getProductById(buildDetailReq(RolesEnum.Client, "999"), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith({} as Response, HttpEnum.NOT_FOUND, expect.any(String));
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });

  it("404s a malformed id WITHOUT touching the database", async () => {
    const { findFirst } = mockDetailPrisma(rawProduct);
    await getProductById(buildDetailReq(RolesEnum.Client, "abc"), {} as Response);
    expect(findFirst).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith({} as Response, HttpEnum.NOT_FOUND, expect.any(String));
  });

  it("sends a 500 when the query fails", async () => {
    (getPrismaClient as Mock).mockRejectedValue(new Error("db down"));
    await getProductById(buildDetailReq(RolesEnum.Admin, "7"), {} as Response);
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
      // A just-created product has no rentals: available = the whole fleet.
      expect.objectContaining({ id: 7, available: 40, total: 40, replacementPrice: 900, isActive: true }),
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
    expect(item.available).toBeUndefined();
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

describe("updateProduct", () => {
  const updateBody = {
    businessTypeId: 1,
    categoryId: 1,
    currencyId: 1,
    description: "Mesa para 8 personas",
    images: [] as unknown[],
    name: "Mesa redonda",
    productDetails: [] as unknown[],
    quantity: 40,
    rentPrice: 75,
    rentTimeUnitId: 2,
    replacementPrice: 900,
    sellPrice: undefined,
  };

  const buildUpdateReq = (
    body: Record<string, unknown> = updateBody,
    role: RolesEnum | null = RolesEnum.Admin,
  ): CustomRequest =>
    ({
      body,
      params: { id: "7" },
      ip: "127.0.0.1",
      user: role === null ? undefined : { userRole: role, userId: 1 },
    }) as unknown as CustomRequest;

  /** A prisma mock whose $transaction hands the callback a tx seeded with the current rows. */
  function mockUpdatePrisma(
    currentImages: { id: number; r2Key: string }[] = [],
    currentDetailIds: number[] = [],
    updated: unknown = rawProduct,
  ) {
    const tx = {
      product: {
        update: vi.fn().mockResolvedValue({}),
        findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
      },
      productImage: {
        findMany: vi.fn().mockResolvedValue(currentImages),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
      },
      productDetail: {
        findMany: vi.fn().mockResolvedValue(currentDetailIds.map((id) => ({ id }))),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const $transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    const groupBy = vi.fn().mockResolvedValue([]);
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction,
      serviceDetail: { groupBy },
    });
    return { tx, $transaction, groupBy };
  }

  it("applies the reconcile in ONE transaction and responds 200 with the projection", async () => {
    const { tx, $transaction, groupBy } = mockUpdatePrisma([], [], rawProduct);
    groupBy.mockResolvedValue([{ productId: 7, _sum: { quantity: 5 } }]);

    await updateProduct(buildUpdateReq(), {} as Response);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } }),
    );
    // The response reflects the state fetched INSIDE the transaction, rentals subtracted.
    expect(tx.product.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 7 },
      include: expect.anything(),
    });
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "products.updateProduct.productUpdated",
      expect.objectContaining({ id: 7, available: 35, total: 40 }),
    );
  });

  it("deletes the removed photos from R2 only AFTER the commit, best-effort", async () => {
    const deleteObject = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("r2 down"));
    (getStorage as Mock).mockReturnValue({ deleteObject });
    mockUpdatePrisma(
      [
        { id: 11, r2Key: "products/gone-1.webp" },
        { id: 12, r2Key: "products/gone-2.webp" },
      ],
      [],
    );

    await updateProduct(buildUpdateReq({ ...updateBody, images: [] }), {} as Response);

    expect(deleteObject).toHaveBeenCalledWith("products/gone-1.webp");
    expect(deleteObject).toHaveBeenCalledWith("products/gone-2.webp");
    // A failed object delete only leaves a sweepable stray — the request still succeeds.
    expect(sendOzariSuccess).toHaveBeenCalled();
    expect(sendOzariError).not.toHaveBeenCalled();
  });

  it("never touches storage when nothing was removed and nothing is new", async () => {
    mockUpdatePrisma([{ id: 1, r2Key: "products/keep.webp" }], []);
    await updateProduct(
      buildUpdateReq({ ...updateBody, images: [{ id: 1, isPrimary: true }] }),
      {} as Response,
    );
    expect(getStorage).not.toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalled();
  });

  it("maps a mid-save concurrency conflict to a clean 409 (reload and retry)", async () => {
    // The validator saw image 99, but by transaction time it's gone — another admin won the race.
    mockUpdatePrisma([], []);
    await updateProduct(
      buildUpdateReq({ ...updateBody, images: [{ id: 99, isPrimary: true }] }),
      {} as Response,
    );

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "products.updateProduct.conflict",
    );
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });

  it("maps the r2_key unique violation (P2002) to the same 400 as create", async () => {
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test", meta: { target: ["r2_key"] } },
    );
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(uniqueViolation),
      serviceDetail: { groupBy: vi.fn() },
    });

    await updateProduct(buildUpdateReq(), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.BAD_REQUEST,
      "products.createProduct.validators.duplicateImageKey",
    );
  });

  it("audit-logs the update only in deployed environments", async () => {
    mockUpdatePrisma();
    await updateProduct(buildUpdateReq(), {} as Response);
    expect(logAudit).not.toHaveBeenCalled();

    (isDeployedEnvironment as Mock).mockReturnValue(true);
    mockUpdatePrisma();
    await updateProduct(buildUpdateReq(), {} as Response);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ADMIN_ACTION",
        userId: 1,
        resource: "Product ID 7",
        success: true,
        metadata: { operation: "PRODUCT_UPDATED" },
      }),
    );
    (isDeployedEnvironment as Mock).mockReturnValue(false);
  });

  it("projects fail-closed (minimum fields) if the role is somehow absent", async () => {
    mockUpdatePrisma();
    await updateProduct(buildUpdateReq(updateBody, null), {} as Response);

    const item = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as ProductListItemResponseModel;
    expect(item.available).toBeUndefined();
    expect(item.isActive).toBeUndefined();
  });

  it("sends a 500 when the transaction fails for any other reason", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
      serviceDetail: { groupBy: vi.fn() },
    });
    await updateProduct(buildUpdateReq(), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "products.updateProduct.genericError",
    );
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });
});

describe("deleteProduct", () => {
  const buildDeleteReq = (role: RolesEnum | null = RolesEnum.Admin): CustomRequest =>
    ({
      params: { id: "7" },
      ip: "127.0.0.1",
      user: role === null ? undefined : { userRole: role, userId: 1 },
    }) as unknown as CustomRequest;

  /** A prisma mock whose $transaction hands the callback a tx seeded for the delete. */
  function mockDeletePrisma(
    imageKeys: string[] = [],
    orderReferences = 0,
  ) {
    const tx = {
      product: {
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      productImage: {
        findMany: vi
          .fn()
          .mockResolvedValue(imageKeys.map((r2Key, index) => ({ id: index + 1, r2Key }))),
        deleteMany: vi.fn().mockResolvedValue({ count: imageKeys.length }),
      },
      productDetail: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      serviceDetail: { count: vi.fn().mockResolvedValue(orderReferences) },
    };
    const $transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    (getPrismaClient as Mock).mockResolvedValue({ $transaction });
    return { tx, $transaction };
  }

  it("runs the no-trash delete in ONE transaction and responds 200", async () => {
    const { tx, $transaction } = mockDeletePrisma([], 0);
    await deleteProduct(buildDeleteReq(), {} as Response);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(getStorage).not.toHaveBeenCalled(); // nothing to clean up
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "products.deleteProduct.productDeleted",
    );
  });

  it("sweeps the gallery from R2 in ONE batched call, best-effort, AFTER the commit", async () => {
    const deleteObjects = vi.fn().mockRejectedValue(new Error("r2 down"));
    (getStorage as Mock).mockReturnValue({ deleteObjects });
    mockDeletePrisma(["products/a.webp", "products/b.webp"], 0);

    await deleteProduct(buildDeleteReq(), {} as Response);

    expect(deleteObjects).toHaveBeenCalledTimes(1);
    expect(deleteObjects).toHaveBeenCalledWith(["products/a.webp", "products/b.webp"]);
    // A failed object delete only leaves a sweepable stray — the request still succeeds.
    expect(sendOzariSuccess).toHaveBeenCalled();
    expect(sendOzariError).not.toHaveBeenCalled();
  });

  it("tombstones instead of deleting when order history references the product", async () => {
    const { tx } = mockDeletePrisma([], 2);
    await deleteProduct(buildDeleteReq(), {} as Response);

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { isActive: false },
    });
    expect(tx.product.delete).not.toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalled();
  });

  it("audit-logs the deletion (with its mode) only in deployed environments", async () => {
    mockDeletePrisma();
    await deleteProduct(buildDeleteReq(), {} as Response);
    expect(logAudit).not.toHaveBeenCalled();

    (isDeployedEnvironment as Mock).mockReturnValue(true);
    mockDeletePrisma([], 5);
    await deleteProduct(buildDeleteReq(), {} as Response);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ADMIN_ACTION",
        resource: "Product ID 7",
        metadata: { operation: "PRODUCT_DELETED", mode: "SOFT" },
      }),
    );
    (isDeployedEnvironment as Mock).mockReturnValue(false);
  });

  it("sends a 500 when the transaction fails", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await deleteProduct(buildDeleteReq(), {} as Response);

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "products.deleteProduct.genericError",
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
