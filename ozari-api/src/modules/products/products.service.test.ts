import { describe, it, expect, vi, type Mock } from "vitest";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { ServiceStatusEnum } from "@models/enums/serviceStatusEnum.js";
import { appConfig } from "@/config/app.js";
import { getStorage } from "@helpers/storage.js";
import {
  applyProductDelete,
  applyProductUpdate,
  buildPaginationMeta,
  buildProductImagesCreate,
  buildProductListWhere,
  buildRentedNowWhere,
  computeAvailableQuantity,
  parseProductListQuery,
  ProductStateConflictError,
  projectProductForRole,
  rentProductIds,
  sortProductIdPage,
  type ProductSortRow,
  type RichProduct,
} from "./products.service.js";

vi.mock("@helpers/storage.js", () => ({ getStorage: vi.fn() }));

/** A full product row shaped like `richProductInclude`'s payload (numbers stand in for Decimals). */
const makeProduct = (overrides: Partial<RichProduct> = {}): RichProduct =>
  ({
    id: 7,
    name: "Mesa redonda",
    description: "Mesa para 8 personas",
    productBusinessTypeId: 1,
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
    productDetails: [
      { id: 12, detail: "Blanco", productDetailTypeId: 1, detailType: { name: "Color" } },
    ],
    productImages: [{ id: 1, url: "https://cdn.example.com/a.webp", isPrimary: true, sortOrder: 0 }],
    ...overrides,
  }) as unknown as RichProduct;

describe("projectProductForRole", () => {
  it("shares the catalog fields with every role (Client = the minimum, no stock info)", () => {
    const result = projectProductForRole(makeProduct(), RolesEnum.Client);
    expect(result).toMatchObject({
      id: 7,
      name: "Mesa redonda",
      description: "Mesa para 8 personas",
      businessType: "Alquiler",
      businessTypeId: 1,
      category: "Mesas",
      categoryId: 1,
      currency: { id: 1, iso4217Code: "GTQ", name: "Quetzal Guatemalteco", symbol: "Q" },
      rentPrice: 75,
      sellPrice: undefined,
      rentTimeUnit: "Día",
      rentTimeUnitId: 2,
      images: [{ id: 1, url: "https://cdn.example.com/a.webp", isPrimary: true, sortOrder: 0 }],
      details: [{ id: 12, detail: "Blanco", detailType: "Color", detailTypeId: 1 }],
    });
    // No stock information whatsoever for a Client.
    expect(result.inStock).toBeUndefined();
    expect(result.available).toBeUndefined();
    expect(result.total).toBeUndefined();
    expect(result.replacementPrice).toBeUndefined();
    expect(result.isActive).toBeUndefined();
  });

  it("adds the availability (signal + available count) for Employee — internals stay Admin-only", () => {
    const result = projectProductForRole(makeProduct({ quantity: 40 }), RolesEnum.Employee);
    expect(result.inStock).toBe(true);
    // The COUNT is what lets an employee answer "can I take an order for 10?" — a bare flag can't.
    expect(result.available).toBe(40);
    // The fleet total is the ADMIN's number — an employee sees only what can be taken.
    expect(result.total).toBeUndefined();
    expect(result.replacementPrice).toBeUndefined();
    expect(result.isActive).toBeUndefined();
  });

  it("subtracts the units out on rentals for Employee (a fully-rented fleet reads as out)", () => {
    const partly = projectProductForRole(makeProduct({ quantity: 40 }), RolesEnum.Employee, 15);
    expect(partly.available).toBe(25);
    expect(partly.inStock).toBe(true);

    const fully = projectProductForRole(makeProduct({ quantity: 40 }), RolesEnum.Employee, 40);
    expect(fully.available).toBe(0);
    expect(fully.inStock).toBe(false);
  });

  it("reflects an out-of-stock product for Employee", () => {
    const result = projectProductForRole(makeProduct({ quantity: 0 }), RolesEnum.Employee);
    expect(result.inStock).toBe(false);
    expect(result.available).toBe(0);
  });

  it("gives Admin the full internal detail — available AND the Alquiler fleet total", () => {
    const result = projectProductForRole(makeProduct({ quantity: 40 }), RolesEnum.Admin, 5);
    expect(result.inStock).toBe(true);
    expect(result.available).toBe(35);
    expect(result.total).toBe(40);
    expect(result.replacementPrice).toBe(900);
    expect(result.isActive).toBe(true);
  });

  it("omits the fleet total for a Venta product (it would just duplicate available)", () => {
    const venta = makeProduct({
      productBusinessTypeId: BusinessTypeEnum.SELL,
      quantity: 12,
    });
    const result = projectProductForRole(venta, RolesEnum.Admin);
    expect(result.available).toBe(12);
    expect(result.total).toBeUndefined();
  });

  it("maps null money/relations to undefined", () => {
    const result = projectProductForRole(
      makeProduct({
        rentPrice: null,
        sellPrice: null,
        replacementPrice: null,
        rentTimeUnit: null,
        rentTimeUnitId: null,
        description: null,
      }),
      RolesEnum.Admin,
    );
    expect(result.rentPrice).toBeUndefined();
    expect(result.sellPrice).toBeUndefined();
    expect(result.rentTimeUnit).toBeUndefined();
    expect(result.rentTimeUnitId).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.replacementPrice).toBeUndefined();
  });
});

describe("computeAvailableQuantity", () => {
  it("passes a Venta product's recorded stock straight through (sales already decremented it)", () => {
    const venta = { quantity: 12, productBusinessTypeId: BusinessTypeEnum.SELL };
    expect(computeAvailableQuantity(venta, 0)).toBe(12);
    // Rented units are meaningless for Venta — ignored even if a caller passed some.
    expect(computeAvailableQuantity(venta, 5)).toBe(12);
  });

  it("subtracts the rented units for Alquiler, floored at 0 (an overbooked fleet never goes negative)", () => {
    const rent = { quantity: 40, productBusinessTypeId: BusinessTypeEnum.RENT };
    expect(computeAvailableQuantity(rent, 0)).toBe(40);
    expect(computeAvailableQuantity(rent, 15)).toBe(25);
    expect(computeAvailableQuantity(rent, 40)).toBe(0);
    expect(computeAvailableQuantity(rent, 45)).toBe(0);
  });
});

describe("rentProductIds", () => {
  it("keeps only the RENT products (Venta availability is never derived)", () => {
    expect(
      rentProductIds([
        { id: 1, productBusinessTypeId: BusinessTypeEnum.RENT },
        { id: 2, productBusinessTypeId: BusinessTypeEnum.SELL },
        { id: 3, productBusinessTypeId: BusinessTypeEnum.RENT },
      ]),
    ).toEqual([1, 3]);
    expect(rentProductIds([])).toEqual([]);
  });
});

describe("buildRentedNowWhere", () => {
  it("selects delivered lines unconditionally and pending lines only inside their event window", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    expect(buildRentedNowWhere([1, 3], now)).toEqual({
      productId: { in: [1, 3] },
      isActive: true,
      service: {
        isActive: true,
        OR: [
          // Delivered = physically out until collected — no window check, so an OVERDUE pickup
          // keeps counting against availability.
          { serviceStatusId: ServiceStatusEnum.DELIVERED },
          {
            serviceStatusId: ServiceStatusEnum.PENDING,
            serviceStart: { lte: now },
            serviceEnd: { gte: now },
          },
        ],
      },
    });
  });
});

/** A minimal sort row (Decimal columns stand in as numbers, like `makeProduct`). */
const sortRow = (
  id: number,
  overrides: Partial<Record<keyof ProductSortRow, unknown>> = {},
): ProductSortRow =>
  ({
    id,
    name: `Producto ${String(id).padStart(2, "0")}`,
    rentPrice: null,
    sellPrice: null,
    createdAt: new Date(Date.UTC(2026, 0, id)),
    ...overrides,
  }) as unknown as ProductSortRow;

describe("sortProductIdPage", () => {
  it("orders by THE price (rent XOR sell coalesced), nulls last in BOTH directions", () => {
    const rows = [
      sortRow(1, { rentPrice: 75 }), // Alquiler Q75
      sortRow(2, { sellPrice: 12 }), // Venta Q12 — must interleave, not group by type
      sortRow(3), // priceless — sinks either way
      sortRow(4, { rentPrice: 30 }),
    ];
    expect(sortProductIdPage(rows, "priceAsc", 1, 10)).toEqual([2, 4, 1, 3]);
    expect(sortProductIdPage(rows, "priceDesc", 1, 10)).toEqual([1, 4, 2, 3]);
  });

  it("orders by name with the Spanish collation (accents fold, ñ after n), both directions", () => {
    const rows = [
      sortRow(1, { name: "Sillas" }),
      sortRow(2, { name: "árbol" }), // á folds into a — leads ascending despite the accent
      sortRow(3, { name: "Ñandú" }), // ñ collates AFTER n in Spanish
      sortRow(4, { name: "nube" }),
    ];
    expect(sortProductIdPage(rows, "nameAsc", 1, 10)).toEqual([2, 4, 3, 1]);
    expect(sortProductIdPage(rows, "nameDesc", 1, 10)).toEqual([1, 3, 4, 2]);
  });

  it("breaks every tie by recency (newest first, id tiebreak) so pages never shuffle", () => {
    const sameDay = new Date(Date.UTC(2026, 5, 1));
    const rows = [
      sortRow(1, { name: "Mesa", createdAt: sameDay }),
      sortRow(2, { name: "mesa", createdAt: new Date(Date.UTC(2026, 5, 2)) }),
      sortRow(3, { name: "MESA", createdAt: sameDay }),
    ];
    // All three names are equal under the base sensitivity → pure recency: newest, then higher id.
    expect(sortProductIdPage(rows, "nameAsc", 1, 10)).toEqual([2, 3, 1]);
    // Priceless ties on the price sort resolve the same way.
    expect(sortProductIdPage(rows, "priceAsc", 1, 10)).toEqual([2, 3, 1]);
  });

  it("slices the requested page from the ordered set (an out-of-range page is just empty)", () => {
    const rows = [1, 2, 3, 4, 5].map((id) => sortRow(id, { sellPrice: id * 10 }));
    expect(sortProductIdPage(rows, "priceAsc", 1, 2)).toEqual([1, 2]);
    expect(sortProductIdPage(rows, "priceAsc", 2, 2)).toEqual([3, 4]);
    expect(sortProductIdPage(rows, "priceAsc", 3, 2)).toEqual([5]);
    expect(sortProductIdPage(rows, "priceAsc", 9, 2)).toEqual([]);
  });
});

/** A parsed query with every filter absent — the where builder's baseline input. */
const makeQuery = (
  overrides: Partial<ReturnType<typeof parseProductListQuery>> = {},
): ReturnType<typeof parseProductListQuery> => ({
  page: 1,
  pageSize: appConfig.defaultProductPageSize,
  search: undefined,
  categoryId: undefined,
  businessTypeId: undefined,
  sort: "recent",
  includeInactive: false,
  ...overrides,
});

describe("buildProductListWhere", () => {
  it("scopes to the active catalog (active product + active lookups) with no filters", () => {
    expect(buildProductListWhere(makeQuery())).toEqual({
      isActive: true,
      businessType: { isActive: true },
      category: { isActive: true },
      currency: { isActive: true },
    });
  });

  it("adds a case-insensitive name contains for a search", () => {
    expect(buildProductListWhere(makeQuery({ search: "mesa" }))).toMatchObject({
      name: { contains: "mesa", mode: "insensitive" },
    });
  });

  it("adds the id filters when present", () => {
    expect(
      buildProductListWhere(makeQuery({ categoryId: 3, businessTypeId: 1 })),
    ).toMatchObject({ productCategoryId: 3, productBusinessTypeId: 1 });
  });

  it("never filters by stock (deliberate: sorting replaced the availability filter)", () => {
    expect(buildProductListWhere(makeQuery())).not.toHaveProperty("quantity");
  });

  it("drops ONLY the product isActive clause for includeInactive (lookups stay active)", () => {
    const where = buildProductListWhere(makeQuery({ includeInactive: true }));
    expect(where).toEqual({
      businessType: { isActive: true },
      category: { isActive: true },
      currency: { isActive: true },
    });
  });
});

describe("parseProductListQuery", () => {
  const DEFAULT = appConfig.defaultProductPageSize;
  const MAX = appConfig.maxProductPageSize;

  it("defaults when the query is absent or empty", () => {
    expect(parseProductListQuery(undefined, RolesEnum.Client)).toEqual(makeQuery());
    expect(parseProductListQuery({}, RolesEnum.Client)).toEqual(makeQuery());
  });

  it("accepts valid numeric strings", () => {
    expect(
      parseProductListQuery({ page: "3", pageSize: "10" }, RolesEnum.Client),
    ).toEqual(makeQuery({ page: 3, pageSize: 10 }));
  });

  it("clamps page to >= 1 and pageSize to [1, max]", () => {
    expect(parseProductListQuery({ page: "0" }, RolesEnum.Client).page).toBe(1);
    expect(parseProductListQuery({ page: "-5" }, RolesEnum.Client).page).toBe(1);
    expect(parseProductListQuery({ pageSize: "999" }, RolesEnum.Client).pageSize).toBe(MAX);
    expect(parseProductListQuery({ pageSize: "0" }, RolesEnum.Client).pageSize).toBe(1);
  });

  it("falls back to defaults for non-integer values", () => {
    expect(parseProductListQuery({ page: "abc", pageSize: "2.5" }, RolesEnum.Client)).toEqual(
      makeQuery({ page: 1, pageSize: DEFAULT }),
    );
  });

  it("trims and caps the search, dropping it when empty or non-string", () => {
    expect(parseProductListQuery({ search: "  mesa  " }, RolesEnum.Client).search).toBe("mesa");
    expect(parseProductListQuery({ search: "   " }, RolesEnum.Client).search).toBeUndefined();
    expect(parseProductListQuery({ search: ["a"] }, RolesEnum.Client).search).toBeUndefined();
    const long = "x".repeat(appConfig.maxProductSearchLength + 20);
    expect(parseProductListQuery({ search: long }, RolesEnum.Client).search).toBe(
      "x".repeat(appConfig.maxProductSearchLength),
    );
  });

  it("keeps a positive integer categoryId and drops anything else", () => {
    expect(parseProductListQuery({ categoryId: "3" }, RolesEnum.Client).categoryId).toBe(3);
    expect(parseProductListQuery({ categoryId: "0" }, RolesEnum.Client).categoryId).toBeUndefined();
    expect(parseProductListQuery({ categoryId: "abc" }, RolesEnum.Client).categoryId).toBeUndefined();
  });

  it("keeps businessTypeId only when it is a known enum value", () => {
    expect(parseProductListQuery({ businessTypeId: "1" }, RolesEnum.Client).businessTypeId).toBe(1);
    expect(parseProductListQuery({ businessTypeId: "2" }, RolesEnum.Client).businessTypeId).toBe(2);
    expect(
      parseProductListQuery({ businessTypeId: "99" }, RolesEnum.Client).businessTypeId,
    ).toBeUndefined();
  });

  it("accepts every allowlisted sort for ANY role and clamps anything else to recent", () => {
    expect(parseProductListQuery({ sort: "priceDesc" }, RolesEnum.Client).sort).toBe("priceDesc");
    expect(parseProductListQuery({ sort: "nameAsc" }, RolesEnum.Employee).sort).toBe("nameAsc");
    expect(parseProductListQuery({ sort: "nameDesc" }, RolesEnum.Admin).sort).toBe("nameDesc");
    expect(parseProductListQuery({ sort: "priceAsc" }, RolesEnum.Client).sort).toBe("priceAsc");
    expect(parseProductListQuery({ sort: "cheapest" }, RolesEnum.Admin).sort).toBe("recent");
    expect(parseProductListQuery({ sort: 42 }, RolesEnum.Admin).sort).toBe("recent");
    expect(parseProductListQuery({}, RolesEnum.Admin).sort).toBe("recent");
  });

  it("honours includeInactive for Admin only, and only the literal 'true'", () => {
    expect(
      parseProductListQuery({ includeInactive: "true" }, RolesEnum.Admin).includeInactive,
    ).toBe(true);
    expect(
      parseProductListQuery({ includeInactive: "true" }, RolesEnum.Employee).includeInactive,
    ).toBe(false);
    expect(
      parseProductListQuery({ includeInactive: "1" }, RolesEnum.Admin).includeInactive,
    ).toBe(false);
  });
});

describe("buildPaginationMeta", () => {
  it("computes totalPages by ceiling, with a floor of 1", () => {
    expect(buildPaginationMeta(1, 24, 0)).toEqual({ page: 1, pageSize: 24, total: 0, totalPages: 1 });
    expect(buildPaginationMeta(2, 10, 25)).toEqual({ page: 2, pageSize: 10, total: 25, totalPages: 3 });
  });
});

// ── applyProductUpdate (the RECONCILE transaction body) ─────────────────────────────────────────

/** A mock Prisma transaction client seeded with the product's CURRENT rows. */
const makeTx = (
  currentImages: { id: number; r2Key: string }[] = [],
  currentDetailIds: number[] = [],
  orderReferences = 0,
) => ({
  product: {
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
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
  serviceDetail: { count: vi.fn().mockResolvedValue(orderReferences) },
});
type MockTx = ReturnType<typeof makeTx>;
const runUpdate = (
  tx: MockTx,
  body: Partial<Parameters<typeof applyProductUpdate>[2]>,
) =>
  applyProductUpdate(
    tx as unknown as Parameters<typeof applyProductUpdate>[0],
    7,
    {
      businessTypeId: 1,
      categoryId: 1,
      currencyId: 1,
      description: "Mesa para 8 personas",
      images: [],
      name: "Mesa redonda",
      productDetails: [],
      quantity: 40,
      rentPrice: 75,
      rentTimeUnitId: 2,
      replacementPrice: undefined,
      sellPrice: undefined,
      ...body,
    },
  );

describe("applyProductUpdate", () => {
  it("updates the scalars, writing explicit nulls for the absent conditional fields", async () => {
    const tx = makeTx();
    await runUpdate(tx, {
      businessTypeId: 2,
      description: undefined,
      rentPrice: undefined,
      rentTimeUnitId: undefined,
      sellPrice: 12.5,
    });

    // A business-type switch must NULL the other side's columns — never leave a stale price.
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        name: "Mesa redonda",
        description: null,
        productBusinessTypeId: 2,
        productCategoryId: 1,
        currencyId: 1,
        quantity: 40,
        rentPrice: null,
        sellPrice: 12.5,
        replacementPrice: null,
        rentTimeUnitId: null,
      },
    });
  });

  it("reconciles the gallery: kept rows update, absent rows delete (keys returned), new keys create", async () => {
    (getStorage as Mock).mockReturnValue({
      getPublicUrl: (key: string) => `https://cdn.test/${key}`,
    });
    const tx = makeTx([
      { id: 11, r2Key: "products/keep.webp" },
      { id: 12, r2Key: "products/drop.webp" },
    ]);

    const result = await runUpdate(tx, {
      images: [
        { key: "products/new.webp", isPrimary: false },
        { id: 11, isPrimary: true },
      ],
    });

    // The removed row is hard-deleted and its key surfaces for the POST-COMMIT R2 cleanup.
    expect(tx.productImage.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [12] } } });
    expect(result.removedImageKeys).toEqual(["products/drop.webp"]);
    // The kept row takes its slot's position + primary flag (array order = sortOrder).
    expect(tx.productImage.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { sortOrder: 1, isPrimary: true },
    });
    // The new key is created with the SERVER-derived URL, never a client one.
    expect(tx.productImage.create).toHaveBeenCalledWith({
      data: {
        productId: 7,
        r2Key: "products/new.webp",
        url: "https://cdn.test/products/new.webp",
        sortOrder: 0,
        isPrimary: false,
      },
    });
    // Deletes run BEFORE creates so a key freed by this same save is immediately reusable.
    expect(
      tx.productImage.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.productImage.create.mock.invocationCallOrder[0]);
  });

  it("never touches storage (or deleteMany) when the gallery only reorders kept photos", async () => {
    (getStorage as Mock).mockClear();
    const tx = makeTx([
      { id: 11, r2Key: "products/a.webp" },
      { id: 12, r2Key: "products/b.webp" },
    ]);

    const result = await runUpdate(tx, {
      images: [
        { id: 12, isPrimary: true },
        { id: 11 },
      ],
    });

    expect(getStorage).not.toHaveBeenCalled();
    expect(tx.productImage.deleteMany).not.toHaveBeenCalled();
    expect(tx.productImage.create).not.toHaveBeenCalled();
    expect(result.removedImageKeys).toEqual([]);
    // An entry without the flag lands as isPrimary: false (=== true, never truthiness).
    expect(tx.productImage.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { sortOrder: 1, isPrimary: false },
    });
  });

  it("throws the conflict error when a kept image id vanished (a concurrent edit won)", async () => {
    const tx = makeTx([{ id: 11, r2Key: "products/a.webp" }]);
    await expect(
      runUpdate(tx, { images: [{ id: 99, isPrimary: true }] }),
    ).rejects.toBeInstanceOf(ProductStateConflictError);
    // Fail-fast: nothing gets deleted or written once the state mismatch is detected.
    expect(tx.productImage.deleteMany).not.toHaveBeenCalled();
    expect(tx.productImage.update).not.toHaveBeenCalled();
  });

  it("reconciles the details: kept rows update, absent rows delete, new rows create", async () => {
    const tx = makeTx([], [21, 22]);

    await runUpdate(tx, {
      productDetails: [
        { id: 21, detailTypeId: 1, detail: "Blanco nieve" },
        { detailTypeId: 2, detail: "Madera de pino" },
      ],
    });

    expect(tx.productDetail.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [22] } } });
    expect(tx.productDetail.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: { productDetailTypeId: 1, detail: "Blanco nieve" },
    });
    expect(tx.productDetail.create).toHaveBeenCalledWith({
      data: { productId: 7, productDetailTypeId: 2, detail: "Madera de pino" },
    });
  });

  it("leaves the details untouched when the final list matches the current one", async () => {
    const tx = makeTx([], [21]);
    await runUpdate(tx, {
      productDetails: [{ id: 21, detailTypeId: 1, detail: "Blanco nieve" }],
    });
    expect(tx.productDetail.deleteMany).not.toHaveBeenCalled();
    expect(tx.productDetail.create).not.toHaveBeenCalled();
  });

  it("throws the conflict error when a kept detail id vanished", async () => {
    const tx = makeTx([], [21]);
    await expect(
      runUpdate(tx, { productDetails: [{ id: 99, detailTypeId: 1, detail: "Blanco nieve" }] }),
    ).rejects.toBeInstanceOf(ProductStateConflictError);
    expect(tx.productDetail.deleteMany).not.toHaveBeenCalled();
    expect(tx.productDetail.update).not.toHaveBeenCalled();
  });
});

describe("applyProductDelete (the no-trash policy)", () => {
  const run = (tx: MockTx) =>
    applyProductDelete(tx as unknown as Parameters<typeof applyProductDelete>[0], 7);

  it("HARD-deletes a product no order ever referenced, sweeping details + images", async () => {
    const tx = makeTx(
      [
        { id: 11, r2Key: "products/a.webp" },
        { id: 12, r2Key: "products/b.webp" },
      ],
      [21],
      0,
    );

    const result = await run(tx);

    expect(tx.productImage.deleteMany).toHaveBeenCalledWith({ where: { productId: 7 } });
    expect(tx.productDetail.deleteMany).toHaveBeenCalledWith({ where: { productId: 7 } });
    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(tx.product.update).not.toHaveBeenCalled();
    // Every R2 key surfaces for the post-commit BATCHED cleanup.
    expect(result).toEqual({
      removedImageKeys: ["products/a.webp", "products/b.webp"],
      hardDeleted: true,
    });
  });

  it("SOFT-deletes (tombstones) only when order history references the product", async () => {
    const tx = makeTx([{ id: 11, r2Key: "products/a.webp" }], [], 3);

    const result = await run(tx);

    // The row survives for the orders that point at it — but its attributes still sweep clean.
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { isActive: false },
    });
    expect(tx.product.delete).not.toHaveBeenCalled();
    expect(tx.productImage.deleteMany).toHaveBeenCalledWith({ where: { productId: 7 } });
    expect(tx.productDetail.deleteMany).toHaveBeenCalledWith({ where: { productId: 7 } });
    expect(result).toEqual({ removedImageKeys: ["products/a.webp"], hardDeleted: false });
  });

  it("handles an image-less product (no keys to clean up)", async () => {
    const tx = makeTx([], [], 0);
    const result = await run(tx);
    expect(result.removedImageKeys).toEqual([]);
    expect(tx.product.delete).toHaveBeenCalled();
  });
});

describe("buildProductImagesCreate", () => {
  it("returns undefined (and never touches storage) for absent or empty images", () => {
    expect(buildProductImagesCreate(undefined)).toBeUndefined();
    expect(buildProductImagesCreate([])).toBeUndefined();
    expect(getStorage).not.toHaveBeenCalled();
  });

  it("maps keys to server-derived URLs with array order as sortOrder", () => {
    (getStorage as Mock).mockReturnValue({
      getPublicUrl: (key: string) => `https://cdn.test/${key}`,
    });
    const result = buildProductImagesCreate([
      { key: "products/k1.webp", isPrimary: false },
      { key: "products/k2.jpg", isPrimary: true },
    ]);

    expect(result).toEqual({
      create: [
        { r2Key: "products/k1.webp", url: "https://cdn.test/products/k1.webp", isPrimary: false, sortOrder: 0 },
        { r2Key: "products/k2.jpg", url: "https://cdn.test/products/k2.jpg", isPrimary: true, sortOrder: 1 },
      ],
    });
  });
});
