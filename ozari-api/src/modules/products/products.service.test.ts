import { describe, it, expect, vi, type Mock } from "vitest";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { appConfig } from "@/config/app.js";
import { getStorage } from "@helpers/storage.js";
import {
  buildPaginationMeta,
  buildProductImagesCreate,
  buildProductListWhere,
  parseProductListQuery,
  projectProductForRole,
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
    productDetails: [{ id: 12, detail: "Blanco", detailType: { name: "Color" } }],
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
      category: "Mesas",
      currency: { id: 1, iso4217Code: "GTQ", name: "Quetzal Guatemalteco", symbol: "Q" },
      rentPrice: 75,
      sellPrice: undefined,
      rentTimeUnit: "Día",
      images: [{ id: 1, url: "https://cdn.example.com/a.webp", isPrimary: true, sortOrder: 0 }],
      details: [{ id: 12, detail: "Blanco", detailType: "Color" }],
    });
    // No stock information whatsoever for a Client.
    expect(result.inStock).toBeUndefined();
    expect(result.quantity).toBeUndefined();
    expect(result.replacementPrice).toBeUndefined();
    expect(result.isActive).toBeUndefined();
  });

  it("adds an in-stock signal for Employee, but never the exact count", () => {
    const result = projectProductForRole(makeProduct({ quantity: 40 }), RolesEnum.Employee);
    expect(result.inStock).toBe(true);
    expect(result.quantity).toBeUndefined();
    expect(result.replacementPrice).toBeUndefined();
    expect(result.isActive).toBeUndefined();
  });

  it("reflects an out-of-stock product for Employee", () => {
    const result = projectProductForRole(makeProduct({ quantity: 0 }), RolesEnum.Employee);
    expect(result.inStock).toBe(false);
  });

  it("gives Admin the full internal detail", () => {
    const result = projectProductForRole(makeProduct({ quantity: 40 }), RolesEnum.Admin);
    expect(result.inStock).toBe(true);
    expect(result.quantity).toBe(40);
    expect(result.replacementPrice).toBe(900);
    expect(result.isActive).toBe(true);
  });

  it("maps null money/relations to undefined", () => {
    const result = projectProductForRole(
      makeProduct({ rentPrice: null, sellPrice: null, replacementPrice: null, rentTimeUnit: null, description: null }),
      RolesEnum.Admin,
    );
    expect(result.rentPrice).toBeUndefined();
    expect(result.sellPrice).toBeUndefined();
    expect(result.rentTimeUnit).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.replacementPrice).toBeUndefined();
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
  inStock: undefined,
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

  it("maps the availability filter to a quantity clause (both directions)", () => {
    expect(buildProductListWhere(makeQuery({ inStock: true }))).toMatchObject({
      quantity: { gt: 0 },
    });
    expect(buildProductListWhere(makeQuery({ inStock: false }))).toMatchObject({
      quantity: 0,
    });
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

  it("honours inStock for Employee and Admin only (a Client can never probe stock)", () => {
    expect(parseProductListQuery({ inStock: "true" }, RolesEnum.Employee).inStock).toBe(true);
    expect(parseProductListQuery({ inStock: "false" }, RolesEnum.Admin).inStock).toBe(false);
    expect(parseProductListQuery({ inStock: "true" }, RolesEnum.Client).inStock).toBeUndefined();
    expect(parseProductListQuery({ inStock: "yes" }, RolesEnum.Admin).inStock).toBeUndefined();
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
