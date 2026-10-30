import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Response } from "express";
import { Prisma } from "@prisma/client";
import {
  createProduct,
  createProductImageUploads,
  deleteProduct,
  getProductById,
  getProductCatalog,
  getProductDisplayOrder,
  getProducts,
  updateProduct,
  updateProductDisplayOrder,
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
  SEEDED_HOLDING_IDS,
  SEEDED_STATUS_CATALOG,
} from "@/tests/fixtures/lifecycleCatalog.js";
import {
  type ProductCatalogResponseModel,
  type ProductListItemResponseModel,
  type ProductListResponseModel,
  type UpdateProductResponseModel,
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
// Availability now asks the LIFECYCLE machine which statuses hold units (`inventory_hold`), so the
// engine stands in with the seeded catalog — its own derivations are covered by lifecycle.service.test.
vi.mock("../orders/lifecycle/lifecycle.service.js", () => ({
  getStatusCatalog: vi.fn(async () => SEEDED_STATUS_CATALOG),
  holdingStatusIds: vi.fn(() => SEEDED_HOLDING_IDS),
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
  options: [],
  variants: [],
};

/** One rented-now grouped row, as `serviceDetail.groupBy` returns it (per stock pool). */
const rentedRow = (productId: number, rented: number | null, variantId: number | null = null) => ({
  productId,
  variantId,
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
    expect(data.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });

  it("subtracts the units out on active rentals from `available` (fleet `total` untouched)", async () => {
    const { groupBy } = mockPrisma([rawProduct], 1, [rentedRow(7, 15)]);
    await getProducts(buildReq(RolesEnum.Admin), {} as Response);

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["productId", "variantId"],
        where: expect.objectContaining({ productId: { in: [7] } }),
        _sum: { quantity: true },
      }),
    );
    expect(successData().products[0]).toMatchObject({ available: 25, total: 40, inStock: true });
  });

  it("defaults a null grouped sum to 0 rented (nothing subtracted)", async () => {
    mockPrisma([rawProduct], 1, [rentedRow(7, null)]);
    await getProducts(buildReq(RolesEnum.Admin), {} as Response);
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
    await getProducts(buildReq(RolesEnum.Client, { page: "2", pageSize: "10" }), {} as Response);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    expect(successData().pagination).toEqual({ page: 2, pageSize: 10, total: 0, totalPages: 1 });
  });

  it("passes the parsed filters through to the where clause (findMany AND count)", async () => {
    const { findMany, count } = mockPrisma([], 0);
    await getProducts(
      buildReq(RolesEnum.Client, {
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

  it("orders by the catalog arrangement by default, and newest-first for sort=recent, in SQL", async () => {
    const { findMany } = mockPrisma([], 0);
    await getProducts(buildReq(RolesEnum.Client), {} as Response);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
    );

    findMany.mockClear();
    await getProducts(buildReq(RolesEnum.Client, { sort: "recent" }), {} as Response);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    );
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
    await getProductById(buildDetailReq(RolesEnum.Admin, "7"), {} as Response);
    const data = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as { product: Record<string, unknown> };
    expect(data.product).toMatchObject({ available: 2, inStock: true, total: 40 });
  });

  it("gives an Admin each variant's per-pool availability and its order-line usage", async () => {
    const variantRows = [55, 56].map((id, index) => ({
      id,
      rentPrice: null,
      sellPrice: null,
      replacementPrice: null,
      securityDeposit: null,
      description: null,
      quantity: 4,
      isDefault: false,
      values: [{ optionValueId: 10 + index }],
    }));
    const product = {
      ...rawProduct,
      quantity: 0,
      options: [
        {
          id: 3,
          name: "Color",
          sortOrder: 0,
          values: [
            { id: 10, name: "Rojo", sortOrder: 0, images: [] },
            { id: 11, name: "Azul", sortOrder: 1, images: [] },
          ],
        },
      ],
      variants: variantRows,
    };
    const { groupBy } = mockDetailPrisma(product, [rentedRow(7, 3, 55)]);
    // 1st groupBy = rented now; 2nd/3rd = loadVariantUsage (all lines, then holding ones).
    groupBy
      .mockResolvedValueOnce([rentedRow(7, 3, 55)])
      .mockResolvedValueOnce([{ variantId: 55, _count: { _all: 5 } }])
      .mockResolvedValueOnce([{ variantId: 55, _count: { _all: 1 } }]);
    await getProductById(buildDetailReq(RolesEnum.Admin, "7"), {} as Response);

    const data = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as {
      product: ProductListItemResponseModel;
    };
    expect(data.product).toMatchObject({ available: 5, total: 8 });
    expect(data.product.variants[0]).toMatchObject({
      id: 55,
      available: 1,
      usage: { lines: 5, holding: 1 },
    });
    expect(data.product.variants[1]).toMatchObject({ id: 56, available: 4, usage: { lines: 0, holding: 0 } });
  });

  it("never loads usage for a Client", async () => {
    const { groupBy } = mockDetailPrisma({ ...rawProduct, variants: [{ id: 55, values: [] }] });
    await getProductById(buildDetailReq(RolesEnum.Client, "7"), {} as Response);
    // Only the rented-now query ran.
    expect(groupBy).toHaveBeenCalledTimes(1);
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
  securityDeposit: undefined,
  sellPrice: undefined,
  options: [] as unknown[],
  variants: [] as unknown[],
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

/** What the mock transaction serves as the product's CURRENT rows (create/update/delete). */
interface TxSeed {
  images?: { id: number; r2Key: string }[];
  detailIds?: number[];
  orderReferences?: number;
  product?: unknown;
  options?: { id: number; values: { id: number }[] }[];
  variants?: {
    id: number;
    combinationKey: string;
    values: { optionValue: { name: string; option: { sortOrder: number } } }[];
  }[];
  /** Served by every non-distinct `serviceDetail.findMany` (the 409 guards). */
  holdingLines?: { serviceId: number; variantId: number | null }[];
  /** Served by the distinct `serviceDetail.findMany` (which variants history references). */
  referencedVariantIds?: number[];
  /** Served by `serviceDetail.groupBy` inside the transaction (`loadVariantUsage`). */
  usageRows?: unknown[];
}

/** A mock transaction client covering every write the product doors make. */
function makeProductTx(seed: TxSeed = {}) {
  let nextId = 100;
  return {
    product: {
      create: vi.fn().mockResolvedValue({ id: 7 }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi.fn().mockResolvedValue(seed.product ?? rawProduct),
    },
    productImage: {
      findMany: vi.fn().mockResolvedValue(seed.images ?? []),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    productDetail: {
      findMany: vi.fn().mockResolvedValue((seed.detailIds ?? []).map((id) => ({ id }))),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    productOption: {
      findMany: vi.fn().mockResolvedValue(seed.options ?? []),
      create: vi.fn().mockImplementation(() => Promise.resolve({ id: nextId++ })),
      update: vi.fn().mockImplementation((args: { where: { id: number } }) =>
        Promise.resolve({ id: args.where.id }),
      ),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    productOptionValue: {
      create: vi.fn().mockImplementation(() => Promise.resolve({ id: nextId++ })),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    productVariant: {
      findMany: vi.fn().mockResolvedValue(seed.variants ?? []),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    serviceDetail: {
      count: vi.fn().mockResolvedValue(seed.orderReferences ?? 0),
      findMany: vi.fn().mockImplementation((args: { distinct?: string[] }) =>
        Promise.resolve(
          args.distinct
            ? (seed.referencedVariantIds ?? []).map((variantId) => ({ variantId }))
            : (seed.holdingLines ?? []),
        ),
      ),
      groupBy: vi.fn().mockResolvedValue(seed.usageRows ?? []),
    },
  };
}
type ProductTx = ReturnType<typeof makeProductTx>;

/** Wires a prisma client whose `$transaction` runs the callback on `tx`. */
function mockTransactionPrisma(tx: ProductTx, rented: ReturnType<typeof rentedRow>[] = []) {
  const $transaction = vi.fn(async (fn: (t: ProductTx) => Promise<unknown>) => fn(tx));
  const groupBy = vi.fn().mockResolvedValue(rented);
  (getPrismaClient as Mock).mockResolvedValue({ $transaction, serviceDetail: { groupBy } });
  return { tx, $transaction, groupBy };
}

/** A variant product row (richProductInclude shape): Color = Rojo (10) / Azul (11). */
const variantProduct = {
  ...rawProduct,
  quantity: 0,
  options: [
    {
      id: 3,
      name: "Color",
      sortOrder: 0,
      values: [
        { id: 10, name: "Rojo", sortOrder: 0, images: [] },
        { id: 11, name: "Azul", sortOrder: 1, images: [] },
      ],
    },
  ],
  variants: [55, 56].map((id, index) => ({
    id,
    rentPrice: null,
    sellPrice: null,
    replacementPrice: null,
    securityDeposit: null,
    description: null,
    quantity: 4,
    isDefault: false,
    values: [{ optionValueId: 10 + index }],
  })),
};

/** The current-variant rows the update reconcile reads for that product. */
const currentColorVariants = [
  { id: 55, combinationKey: "10", values: [{ optionValue: { name: "Rojo", option: { sortOrder: 0 } } }] },
  { id: 56, combinationKey: "11", values: [{ optionValue: { name: "Azul", option: { sortOrder: 0 } } }] },
];

const colorBody = (variants: unknown[]) => ({
  quantity: 0,
  options: [
    {
      id: 3,
      name: "Color",
      values: [
        { id: 10, key: "v10", name: "Rojo", images: [] },
        { id: 11, key: "v11", name: "Azul", images: [] },
      ],
    },
  ],
  variants,
});

const keptVariant = (id: number, valueKey: string) => ({
  id,
  valueKeys: [valueKey],
  quantity: 4,
  rentPrice: undefined,
  sellPrice: undefined,
  replacementPrice: undefined,
  securityDeposit: undefined,
  description: undefined,
  isDefault: false,
});

describe("createProduct", () => {
  function mockCreate(created: unknown = rawProduct) {
    const tx = makeProductTx({ product: created });
    return mockTransactionPrisma(tx);
  }

  it("creates the product with nested details IN ONE TRANSACTION and responds 201 with the Admin projection", async () => {
    const { tx, $transaction } = mockCreate();
    await createProduct(buildCreateReq(), {} as Response);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.product.create).toHaveBeenCalledWith({
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
      }) as unknown,
      select: { id: true },
    });
    // The response is the committed row, re-read inside the transaction.
    expect(tx.product.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 7 },
      include: expect.anything() as unknown,
    });

    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CREATED,
      "products.createProduct.productCreated",
      // A just-created product has no rentals: available = the whole fleet.
      expect.objectContaining({ id: 7, available: 40, total: 40, replacementPrice: 900, isActive: true }),
    );
  });

  it("creates gallery images with server-derived URLs (never a client URL)", async () => {
    (getStorage as Mock).mockReturnValue({
      getPublicUrl: (key: string) => `https://cdn.test/${key}`,
    });
    const { tx } = mockCreate();
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

    expect(tx.productImage.create.mock.calls.map(([args]) => args as unknown)).toEqual([
      {
        data: {
          productId: 7,
          r2Key: key1,
          url: `https://cdn.test/${key1}`,
          isPrimary: false,
          sortOrder: 0,
          optionValueId: null,
        },
      },
      {
        data: {
          productId: 7,
          r2Key: key2,
          url: `https://cdn.test/${key2}`,
          isPrimary: true,
          sortOrder: 1,
          optionValueId: null,
        },
      },
    ]);
  });

  it("never touches storage on an image-less create (works without the R2 env)", async () => {
    const { tx } = mockCreate();
    await createProduct(buildCreateReq(), {} as Response);

    expect(getStorage).not.toHaveBeenCalled();
    expect(tx.productImage.create).not.toHaveBeenCalled();
  });

  it("omits the nested details create when the list is empty", async () => {
    const { tx } = mockCreate();
    await createProduct(buildCreateReq({ ...createBody, productDetails: [] }), {} as Response);

    const data = (tx.product.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("productDetails");
  });

  it("writes the variations in the same transaction", async () => {
    const { tx } = mockCreate(variantProduct);
    await createProduct(
      buildCreateReq({
        ...createBody,
        quantity: 0,
        options: [{ name: "Color", values: [{ key: "r", name: "Rojo", images: [] }] }],
        variants: [{ ...keptVariant(0, "r"), id: undefined }],
      }),
      {} as Response,
    );
    expect(tx.productOption.create).toHaveBeenCalledTimes(1);
    expect(tx.productVariant.create).toHaveBeenCalledTimes(1);
    const item = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as ProductListItemResponseModel;
    // The product's Admin stock is Σ its variants.
    expect(item).toMatchObject({ available: 8, total: 8 });
    expect(item.variants).toHaveLength(2);
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
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
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
      $transaction: vi.fn().mockRejectedValue(uniqueViolation),
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
    securityDeposit: undefined,
    sellPrice: undefined,
    options: [] as unknown[],
    variants: [] as unknown[],
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
  function mockUpdatePrisma(seed: TxSeed = {}, rented: ReturnType<typeof rentedRow>[] = []) {
    return mockTransactionPrisma(makeProductTx(seed), rented);
  }

  it("applies the reconcile in ONE transaction and responds 200 with the projection", async () => {
    const { tx, $transaction } = mockUpdatePrisma({}, [rentedRow(7, 5)]);

    await updateProduct(buildUpdateReq(), {} as Response);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } }),
    );
    // The response reflects the state fetched INSIDE the transaction, rentals subtracted.
    expect(tx.product.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 7 },
      include: expect.anything() as unknown,
    });
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "products.updateProduct.productUpdated",
      expect.objectContaining({ id: 7, available: 35, total: 40 }),
    );
    // Nothing was removed → no outcome to report.
    const item = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as Record<string, unknown>;
    expect(item).not.toHaveProperty("variantOutcome");
  });

  it("deletes the removed photos from R2 only AFTER the commit, best-effort", async () => {
    const deleteObject = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("r2 down"));
    (getStorage as Mock).mockReturnValue({ deleteObject });
    mockUpdatePrisma({
      images: [
        { id: 11, r2Key: "products/gone-1.webp" },
        { id: 12, r2Key: "products/gone-2.webp" },
      ],
    });

    await updateProduct(buildUpdateReq({ ...updateBody, images: [] }), {} as Response);

    expect(deleteObject).toHaveBeenCalledWith("products/gone-1.webp");
    expect(deleteObject).toHaveBeenCalledWith("products/gone-2.webp");
    // A failed object delete only leaves a sweepable stray — the request still succeeds.
    expect(sendOzariSuccess).toHaveBeenCalled();
    expect(sendOzariError).not.toHaveBeenCalled();
  });

  it("never touches storage when nothing was removed and nothing is new", async () => {
    mockUpdatePrisma({ images: [{ id: 1, r2Key: "products/keep.webp" }] });
    await updateProduct(
      buildUpdateReq({ ...updateBody, images: [{ id: 1, isPrimary: true }] }),
      {} as Response,
    );
    expect(getStorage).not.toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalled();
  });

  it("maps a mid-save concurrency conflict to a clean 409 (reload and retry)", async () => {
    // The validator saw image 99, but by transaction time it's gone — another admin won the race.
    mockUpdatePrisma();
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

  it("answers 409 variantInUse with the blocked variants and their orders", async () => {
    mockUpdatePrisma({
      options: [{ id: 3, values: [{ id: 10 }, { id: 11 }] }],
      variants: currentColorVariants,
      holdingLines: [{ serviceId: 9, variantId: 56 }],
    });
    await updateProduct(
      buildUpdateReq({ ...updateBody, ...colorBody([keptVariant(55, "v10")]) }),
      {} as Response,
    );

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "products.updateProduct.variantInUse",
      undefined,
      { conflicts: [{ variantId: 56, label: "Azul", orderIds: [9] }] },
    );
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });

  it("answers 409 stockModeInUse with the orders holding the product's own stock", async () => {
    mockUpdatePrisma({ holdingLines: [{ serviceId: 4, variantId: null }] });
    await updateProduct(
      buildUpdateReq({
        ...updateBody,
        quantity: 0,
        options: [{ name: "Color", values: [{ key: "r", name: "Rojo", images: [] }] }],
        variants: [{ ...keptVariant(0, "r"), id: undefined }],
      }),
      {} as Response,
    );

    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "products.updateProduct.stockModeInUse",
      undefined,
      { orderIds: [4] },
    );
  });

  it("reports variantOutcome (retired vs deleted) and each variant's usage", async () => {
    mockUpdatePrisma({
      product: { ...variantProduct, variants: [variantProduct.variants[0]] },
      options: [{ id: 3, values: [{ id: 10 }, { id: 11 }] }],
      variants: currentColorVariants,
      referencedVariantIds: [56],
      usageRows: [{ variantId: 55, _count: { _all: 2 } }],
    });
    await updateProduct(
      buildUpdateReq({ ...updateBody, ...colorBody([keptVariant(55, "v10")]) }),
      {} as Response,
    );

    const item = (sendOzariSuccess as Mock).mock.calls[0]?.[3] as UpdateProductResponseModel;
    expect(item.variantOutcome).toEqual({ retired: [{ id: 56, label: "Azul" }], deleted: 0 });
    // Both groupBys of loadVariantUsage answer from the seed → lines 2, holding 2.
    expect(item.variants[0]?.usage).toEqual({ lines: 2, holding: 2 });
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
  function mockDeletePrisma(imageKeys: string[] = [], orderReferences = 0) {
    return mockTransactionPrisma(
      makeProductTx({
        images: imageKeys.map((r2Key, index) => ({ id: index + 1, r2Key })),
        orderReferences,
      }),
    );
  }

  it("runs the no-trash delete in ONE transaction and responds 200 with outcome `deleted`", async () => {
    const { tx, $transaction } = mockDeletePrisma([], 0);
    await deleteProduct(buildDeleteReq(), {} as Response);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(getStorage).not.toHaveBeenCalled(); // nothing to clean up
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "products.deleteProduct.productDeleted",
      { outcome: "deleted" },
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

  it("tombstones instead of deleting when order history references the product (outcome `deactivated`)", async () => {
    const { tx } = mockDeletePrisma([], 2);
    await deleteProduct(buildDeleteReq(), {} as Response);

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { isActive: false },
    });
    expect(tx.product.delete).not.toHaveBeenCalled();
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "products.deleteProduct.productDeleted",
      { outcome: "deactivated" },
    );
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

describe("getProductDisplayOrder", () => {
  const arrangementRow = {
    id: 7,
    name: "Mesa redonda",
    displayOrder: 0,
    category: { name: "Mesas" },
    businessType: { name: "Alquiler" },
    productImages: [{ url: "https://cdn.example.com/a.webp", isPrimary: true }],
    options: [],
    variants: [],
  };

  it("returns every active product in catalog order, a card's worth each", async () => {
    const findMany = vi.fn().mockResolvedValue([arrangementRow]);
    (getPrismaClient as Mock).mockResolvedValue({ product: { findMany } });

    await getProductDisplayOrder(buildReq(RolesEnum.Admin), {} as Response);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "products.displayOrder.fetched",
      {
        products: [
          {
            id: 7,
            name: "Mesa redonda",
            category: "Mesas",
            businessType: "Alquiler",
            imageUrl: "https://cdn.example.com/a.webp",
            placed: false,
          },
        ],
      },
    );
  });

  it("sends a 500 when the read fails", async () => {
    (getPrismaClient as Mock).mockRejectedValue(new Error("db down"));
    await getProductDisplayOrder(buildReq(RolesEnum.Admin), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "products.displayOrder.errorFetching",
    );
  });
});

describe("updateProductDisplayOrder", () => {
  const buildOrderReq = (productIds: number[], withUser = true): CustomRequest =>
    ({
      body: { productIds },
      ip: "127.0.0.1",
      user: withUser ? { userRole: RolesEnum.Admin, userId: 1 } : undefined,
    }) as unknown as CustomRequest;

  /** A prisma mock whose $transaction hands the callback a tx holding `current` active rows. */
  function mockOrderPrisma(current: { id: number; displayOrder: number }[]) {
    const committed = current.map((row) => ({
      id: row.id,
      name: `P${row.id}`,
      displayOrder: row.displayOrder,
      category: { name: "Mesas" },
      businessType: { name: "Alquiler" },
      productImages: [],
      options: [],
      variants: [],
    }));
    const tx = {
      product: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce(current) // the set check inside applyProductDisplayOrder
          .mockResolvedValueOnce(committed), // the committed re-read
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const $transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    (getPrismaClient as Mock).mockResolvedValue({ $transaction });
    return { tx, $transaction };
  }

  it("renumbers in ONE transaction and answers with the committed order", async () => {
    const { tx, $transaction } = mockOrderPrisma([
      { id: 1, displayOrder: 0 },
      { id: 2, displayOrder: 0 },
    ]);

    await updateProductDisplayOrder(buildOrderReq([2, 1]), {} as Response);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { displayOrder: 1 } });
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { displayOrder: 2 } });
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      "products.displayOrder.updated",
      { products: expect.arrayContaining([expect.objectContaining({ id: 1 })]) },
    );
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("audit-logs the arrangement only in deployed environments", async () => {
    (isDeployedEnvironment as Mock).mockReturnValue(true);
    mockOrderPrisma([{ id: 1, displayOrder: 1 }]);
    await updateProductDisplayOrder(buildOrderReq([1]), {} as Response);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ADMIN_ACTION",
        userId: 1,
        resource: "Product display order",
        metadata: { operation: "PRODUCT_DISPLAY_ORDER_UPDATED", count: 1 },
      }),
    );

    vi.clearAllMocks();
    mockOrderPrisma([{ id: 1, displayOrder: 1 }]);
    await updateProductDisplayOrder(buildOrderReq([1], false), {} as Response);
    expect(logAudit).toHaveBeenCalledWith(expect.not.objectContaining({ userId: 1 }));
    (isDeployedEnvironment as Mock).mockReturnValue(false);
  });

  it("answers 409 when the list no longer matches the active catalog", async () => {
    mockOrderPrisma([
      { id: 1, displayOrder: 0 },
      { id: 2, displayOrder: 0 },
    ]);
    await updateProductDisplayOrder(buildOrderReq([1]), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.CONFLICT,
      "products.displayOrder.conflict",
    );
    expect(sendOzariSuccess).not.toHaveBeenCalled();
  });

  it("sends a 500 when the transaction fails", async () => {
    (getPrismaClient as Mock).mockResolvedValue({
      $transaction: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await updateProductDisplayOrder(buildOrderReq([1]), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "products.displayOrder.errorUpdating",
    );
  });
});
