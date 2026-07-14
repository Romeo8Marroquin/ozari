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

describe("buildProductListWhere", () => {
  it("scopes to the active catalog (active product + active lookups)", () => {
    expect(buildProductListWhere()).toEqual({
      isActive: true,
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
    expect(parseProductListQuery(undefined)).toEqual({ page: 1, pageSize: DEFAULT });
    expect(parseProductListQuery({})).toEqual({ page: 1, pageSize: DEFAULT });
  });

  it("accepts valid numeric strings", () => {
    expect(parseProductListQuery({ page: "3", pageSize: "10" })).toEqual({ page: 3, pageSize: 10 });
  });

  it("clamps page to >= 1 and pageSize to [1, max]", () => {
    expect(parseProductListQuery({ page: "0" }).page).toBe(1);
    expect(parseProductListQuery({ page: "-5" }).page).toBe(1);
    expect(parseProductListQuery({ pageSize: "999" }).pageSize).toBe(MAX);
    expect(parseProductListQuery({ pageSize: "0" }).pageSize).toBe(1);
  });

  it("falls back to defaults for non-integer values", () => {
    expect(parseProductListQuery({ page: "abc", pageSize: "2.5" })).toEqual({ page: 1, pageSize: DEFAULT });
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
