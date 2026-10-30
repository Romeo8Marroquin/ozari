import { describe, it, expect, vi, type Mock } from "vitest";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { appConfig } from "@/config/app.js";
import { SEEDED_HOLDING_IDS } from "@/tests/fixtures/lifecycleCatalog.js";
import { getStorage } from "@helpers/storage.js";
import {
  applyProductCreate,
  applyProductDelete,
  applyProductDisplayOrder,
  applyProductUpdate,
  combinationKeyOf,
  coverImageUrl,
  describeVariants,
  isSqlProductSort,
  loadVariantUsage,
  primaryImageUrl,
  ProductDisplayOrderConflictError,
  ProductStockModeInUseError,
  ProductVariantInUseError,
  projectArrangementItem,
  type ArrangementRow,
  buildPaginationMeta,
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
import type {
  CreateProductRequestModel,
  ProductOptionRequestModel,
  ProductVariantRequestModel,
} from "./products.models.js";

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
    securityDeposit: 300,
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
    options: [],
    variants: [],
    ...overrides,
  }) as unknown as RichProduct;

/** Units out right now for the product's OWN pool (no variants) — `stockKey(7, null)`. */
const rentedOwn = (units: number) => ({ rentedNow: new Map([["7:", units]]) });

// ── Variation fixtures: Color (Rojo, Azul) × Tamaño (Grande) ────────────────────────────────────
const variationOptions = [
  {
    id: 3,
    name: "Color",
    sortOrder: 0,
    values: [
      {
        id: 10,
        name: "Rojo",
        sortOrder: 0,
        images: [
          { id: 31, url: "https://cdn.test/rojo-1.webp", isPrimary: false, sortOrder: 0 },
          { id: 32, url: "https://cdn.test/rojo-2.webp", isPrimary: true, sortOrder: 1 },
        ],
      },
      { id: 11, name: "Azul", sortOrder: 1, images: [] },
    ],
  },
  {
    id: 4,
    name: "Tamaño",
    sortOrder: 1,
    values: [
      {
        id: 20,
        name: "Grande",
        sortOrder: 0,
        images: [{ id: 41, url: "https://cdn.test/grande.webp", isPrimary: false, sortOrder: 0 }],
      },
    ],
  },
];

/** An active variant row as `richProductInclude.variants` returns it (no overrides by default). */
const variantRow = (id: number, valueIds: number[], overrides: Record<string, unknown> = {}) => ({
  id,
  rentPrice: null,
  sellPrice: null,
  replacementPrice: null,
  securityDeposit: null,
  description: null,
  quantity: 5,
  isDefault: false,
  values: valueIds.map((optionValueId) => ({ optionValueId })),
  ...overrides,
});

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
      // The deposit is a public commercial condition, like the price — unlike `replacementPrice`.
      securityDeposit: 300,
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

  it("gives a Driver the minimum too — the Employee availability tier is gone (Epic-2A)", () => {
    // Drivers are route-blocked from products anyway; the projection stays fail-closed regardless.
    const result = projectProductForRole(makeProduct({ quantity: 40 }), RolesEnum.Driver);
    expect(result.inStock).toBeUndefined();
    expect(result.available).toBeUndefined();
    expect(result.total).toBeUndefined();
    expect(result.replacementPrice).toBeUndefined();
    expect(result.isActive).toBeUndefined();
  });

  it("gives Admin the full internal detail — available AND the Alquiler fleet total", () => {
    const result = projectProductForRole(makeProduct({ quantity: 40 }), RolesEnum.Admin, rentedOwn(5));
    expect(result.inStock).toBe(true);
    expect(result.available).toBe(35);
    expect(result.total).toBe(40);
    expect(result.replacementPrice).toBe(900);
    expect(result.isActive).toBe(true);
  });

  it("subtracts the units out on rentals for Admin (a fully-rented fleet reads as out)", () => {
    const partly = projectProductForRole(makeProduct({ quantity: 40 }), RolesEnum.Admin, rentedOwn(15));
    expect(partly.available).toBe(25);
    expect(partly.inStock).toBe(true);

    const fully = projectProductForRole(makeProduct({ quantity: 40 }), RolesEnum.Admin, rentedOwn(40));
    expect(fully.available).toBe(0);
    expect(fully.inStock).toBe(false);
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
        securityDeposit: null,
        rentTimeUnit: null,
        rentTimeUnitId: null,
        description: null,
      }),
      RolesEnum.Admin,
    );
    expect(result.securityDeposit).toBeUndefined();
    expect(result.rentPrice).toBeUndefined();
    expect(result.sellPrice).toBeUndefined();
    expect(result.rentTimeUnit).toBeUndefined();
    expect(result.rentTimeUnitId).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.replacementPrice).toBeUndefined();
  });

  it("ships a product without variations with empty options/variants and its showcase cover", () => {
    const result = projectProductForRole(makeProduct(), RolesEnum.Client);
    expect(result.options).toEqual([]);
    expect(result.variants).toEqual([]);
    expect(result.coverImageUrl).toBe("https://cdn.example.com/a.webp");
  });
});

describe("projectProductForRole — variations", () => {
  const withVariants = (overrides: Partial<RichProduct> = {}) =>
    makeProduct({
      quantity: 0,
      options: variationOptions,
      variants: [
        variantRow(56, [11, 20], { isDefault: true }),
        variantRow(55, [10, 20], {
          rentPrice: 60,
          securityDeposit: 0,
          description: "Rojo intenso",
        }),
      ],
      ...overrides,
    } as unknown as Partial<RichProduct>);

  it("gives every role the options and the variants with EFFECTIVE values, in canonical order", () => {
    const result = projectProductForRole(withVariants(), RolesEnum.Client);

    expect(result.options).toEqual([
      {
        id: 3,
        name: "Color",
        sortOrder: 0,
        values: [
          {
            id: 10,
            name: "Rojo",
            sortOrder: 0,
            images: [
              { id: 31, url: "https://cdn.test/rojo-1.webp", isPrimary: false, sortOrder: 0 },
              { id: 32, url: "https://cdn.test/rojo-2.webp", isPrimary: true, sortOrder: 1 },
            ],
          },
          { id: 11, name: "Azul", sortOrder: 1, images: [] },
        ],
      },
      {
        id: 4,
        name: "Tamaño",
        sortOrder: 1,
        values: [
          {
            id: 20,
            name: "Grande",
            sortOrder: 0,
            images: [{ id: 41, url: "https://cdn.test/grande.webp", isPrimary: false, sortOrder: 0 }],
          },
        ],
      },
    ]);
    // Rojo (value order 0) leads Azul (1) whatever the row order; deposit 0 = explicitly none.
    expect(result.variants).toEqual([
      {
        id: 55,
        valueIds: [10, 20],
        label: "Rojo · Grande",
        isDefault: false,
        rentPrice: 60,
        sellPrice: undefined,
        securityDeposit: 0,
        description: "Rojo intenso",
        // The FIRST option's value with photos gives its flagged primary.
        imageUrl: "https://cdn.test/rojo-2.webp",
      },
      {
        id: 56,
        valueIds: [11, 20],
        label: "Azul · Grande",
        isDefault: true,
        rentPrice: 75,
        sellPrice: undefined,
        securityDeposit: 300,
        description: "Mesa para 8 personas",
        // Azul has no photos → precedence moves to the next option's value (its first photo).
        imageUrl: "https://cdn.test/grande.webp",
      },
    ]);
    expect(result.coverImageUrl).toBe("https://cdn.example.com/a.webp");
    // No stock, no overrides, no usage for a Client.
    expect(result.available).toBeUndefined();
    expect(result.variants[0]).not.toHaveProperty("quantity");
    expect(result.variants[0]).not.toHaveProperty("overrides");
  });

  it("gives Admin each variant's stock and raw overrides, and the product's Σ stock", () => {
    const result = projectProductForRole(withVariants(), RolesEnum.Admin, {
      rentedNow: new Map([
        ["7:55", 2],
        ["7:56", 9],
      ]),
    });

    expect(result.variants[0]).toMatchObject({
      id: 55,
      quantity: 5,
      available: 3,
      inStock: true,
      total: 5,
      replacementPrice: 900,
      overrides: {
        rentPrice: 60,
        sellPrice: undefined,
        replacementPrice: undefined,
        securityDeposit: 0,
        description: "Rojo intenso",
      },
    });
    // An overbooked variant floors at 0.
    expect(result.variants[1]).toMatchObject({ id: 56, available: 0, inStock: false });
    expect(result.variants[1]?.overrides).toEqual({
      rentPrice: undefined,
      sellPrice: undefined,
      replacementPrice: undefined,
      securityDeposit: undefined,
      description: undefined,
    });
    // `products.quantity` (0) is never read: the product's stock IS its variants'.
    expect(result).toMatchObject({ total: 10, available: 3, inStock: true });
    // `usage` only when the caller loaded it (detail + PUT).
    expect(result.variants[0]).not.toHaveProperty("usage");
  });

  it("reports usage per variant when given — a variant no line uses reads zero", () => {
    const result = projectProductForRole(withVariants(), RolesEnum.Admin, {
      usage: new Map([[55, { lines: 3, holding: 1 }]]),
    });
    expect(result.variants[0]?.usage).toEqual({ lines: 3, holding: 1 });
    expect(result.variants[1]?.usage).toEqual({ lines: 0, holding: 0 });
    // Nothing rented → every unit available.
    expect(result.available).toBe(10);
  });

  it("omits the fleet totals for a Venta product with variants (sell override effective)", () => {
    const result = projectProductForRole(
      withVariants({
        productBusinessTypeId: BusinessTypeEnum.SELL,
        rentPrice: null,
        sellPrice: 12,
        securityDeposit: null,
        replacementPrice: null,
        variants: [variantRow(55, [10, 20], { sellPrice: 15, quantity: 4 })],
      } as unknown as Partial<RichProduct>),
      RolesEnum.Admin,
    );
    expect(result.variants[0]).toMatchObject({ sellPrice: 15, available: 4, quantity: 4 });
    expect(result.variants[0]).not.toHaveProperty("total");
    expect(result).toMatchObject({ available: 4, inStock: true });
    expect(result.total).toBeUndefined();
  });

  it("covers with the DEFAULT variant's photo when there is no showcase, else nothing", () => {
    expect(projectProductForRole(withVariants({ productImages: [] }), RolesEnum.Client).coverImageUrl).toBe(
      "https://cdn.test/grande.webp",
    );
    const photoless = withVariants({
      productImages: [],
      options: variationOptions.map((option) => ({
        ...option,
        values: option.values.map((value) => ({ ...value, images: [] })),
      })),
    } as unknown as Partial<RichProduct>);
    const result = projectProductForRole(photoless, RolesEnum.Client);
    expect(result.coverImageUrl).toBeUndefined();
    expect(result.variants[0]?.imageUrl).toBeUndefined();
  });

  it("falls back to the showcase primary for a variant whose values have no photos", () => {
    const result = projectProductForRole(
      withVariants({
        options: variationOptions.map((option) => ({
          ...option,
          values: option.values.map((value) => ({ ...value, images: [] })),
        })),
      } as unknown as Partial<RichProduct>),
      RolesEnum.Client,
    );
    expect(result.variants.map((variant) => variant.imageUrl)).toEqual([
      "https://cdn.example.com/a.webp",
      "https://cdn.example.com/a.webp",
    ]);
  });

  it("leaves a variant's description absent when neither it nor the product has one", () => {
    const result = projectProductForRole(
      withVariants({ description: null } as unknown as Partial<RichProduct>),
      RolesEnum.Client,
    );
    expect(result.variants.map((variant) => variant.description)).toEqual([
      "Rojo intenso",
      undefined,
    ]);
  });
});

describe("describeVariants", () => {
  it("orders by OPTION order then value order (sortOrder, id tiebreak), labels and defaults", () => {
    // Options arrive out of order; Tamaño (sortOrder 0 here) now leads the label.
    const options = [
      { ...variationOptions[0]!, sortOrder: 1 },
      {
        id: 4,
        name: "Tamaño",
        sortOrder: 0,
        values: [
          { id: 21, name: "Chico", sortOrder: 0, images: [] },
          { id: 20, name: "Grande", sortOrder: 0, images: [] },
        ],
      },
    ];
    const described = describeVariants(options, [
      variantRow(1, [11, 21]),
      variantRow(2, [10, 21]),
      variantRow(3, [10, 20]),
    ]);
    expect(described.map((entry) => [entry.variant.id, entry.label, entry.valueIds])).toEqual([
      // Grande (id 20) ties Chico (21) on sortOrder → the lower id ranks first.
      [3, "Grande · Rojo", [20, 10]],
      [2, "Chico · Rojo", [21, 10]],
      [1, "Chico · Azul", [21, 11]],
    ]);
    // Nothing flagged → the FIRST canonical variant is the default (exactly one).
    expect(described.map((entry) => entry.isDefault)).toEqual([true, false, false]);
  });

  it("ignores a value id the structure does not know and breaks full ties by id", () => {
    const described = describeVariants(variationOptions, [
      variantRow(9, [10, 20]),
      variantRow(8, [10, 999]),
      variantRow(7, [10, 20]),
    ]);
    expect(described.map((entry) => entry.variant.id)).toEqual([7, 8, 9]);
    // Two options on the same sortOrder (a stale save): the lower option id leads the label.
    const tied = describeVariants(
      [
        { ...variationOptions[1]!, sortOrder: 0 },
        { ...variationOptions[0]!, sortOrder: 0 },
      ],
      [variantRow(1, [20, 10])],
    );
    expect(tied[0]?.label).toBe("Rojo · Grande");
    expect(described[1]?.valueIds).toEqual([10]);
    expect(described[1]?.label).toBe("Rojo");
    expect(describeVariants([], [])).toEqual([]);
  });
});

describe("primaryImageUrl / coverImageUrl / combinationKeyOf", () => {
  it("picks the flagged primary, else the first, else nothing", () => {
    expect(
      primaryImageUrl([
        { url: "a", isPrimary: false },
        { url: "b", isPrimary: true },
      ]),
    ).toBe("b");
    expect(primaryImageUrl([{ url: "a", isPrimary: false }])).toBe("a");
    expect(primaryImageUrl([])).toBeUndefined();
  });

  it("covers with the showcase, else the default variant's value photo", () => {
    const showcase = [{ url: "s", isPrimary: true }];
    const described = [
      { isDefault: false, valueImageUrl: "x" },
      { isDefault: true, valueImageUrl: "d" },
    ];
    expect(coverImageUrl(showcase, described)).toBe("s");
    expect(coverImageUrl([], described)).toBe("d");
    expect(coverImageUrl([], [])).toBeUndefined();
  });

  it("sorts value ids numerically into the combination key", () => {
    expect(combinationKeyOf([34, 12, 9])).toBe("9.12.34");
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
  it("holds OUT statuses unconditionally and WINDOW ones only during their event window", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    // The ids come from the lifecycle flags (`holdingStatusIds`), never from literals here.
    expect(buildRentedNowWhere([1, 3], now, SEEDED_HOLDING_IDS)).toEqual({
      productId: { in: [1, 3] },
      isActive: true,
      isRental: true,
      service: {
        isActive: true,
        cancelledAt: null,
        OR: [
          // En ruta / Entregado / Recolectado = physically gone or being washed — no window check,
          // so an OVERDUE pickup (or a pending cleaning) keeps counting against availability.
          { serviceStatusId: { in: SEEDED_HOLDING_IDS.out } },
          {
            serviceStatusId: { in: SEEDED_HOLDING_IDS.window },
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
  sort: "catalog",
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

  it("accepts every allowlisted sort for ANY role and clamps anything else to catalog", () => {
    expect(parseProductListQuery({ sort: "priceDesc" }, RolesEnum.Client).sort).toBe("priceDesc");
    expect(parseProductListQuery({ sort: "nameAsc" }, RolesEnum.Driver).sort).toBe("nameAsc");
    expect(parseProductListQuery({ sort: "nameDesc" }, RolesEnum.Admin).sort).toBe("nameDesc");
    expect(parseProductListQuery({ sort: "priceAsc" }, RolesEnum.Client).sort).toBe("priceAsc");
    expect(parseProductListQuery({ sort: "recent" }, RolesEnum.Client).sort).toBe("recent");
    expect(parseProductListQuery({ sort: "cheapest" }, RolesEnum.Admin).sort).toBe("catalog");
    expect(parseProductListQuery({ sort: 42 }, RolesEnum.Admin).sort).toBe("catalog");
    expect(parseProductListQuery({}, RolesEnum.Admin).sort).toBe("catalog");
  });

  it("honours includeInactive for Admin only, and only the literal 'true'", () => {
    expect(
      parseProductListQuery({ includeInactive: "true" }, RolesEnum.Admin).includeInactive,
    ).toBe(true);
    expect(
      parseProductListQuery({ includeInactive: "true" }, RolesEnum.Driver).includeInactive,
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

type LabelValues = { optionValue: { name: string; option: { sortOrder: number } } }[];

/** Join rows as the reconcile's current-variant read returns them. */
const labelValues = (...names: string[]): LabelValues =>
  names.map((name, sortOrder) => ({ optionValue: { name, option: { sortOrder } } }));

/** The product's CURRENT rows, as the mock transaction serves them. */
interface TxState {
  images?: { id: number; r2Key: string }[];
  detailIds?: number[];
  orderReferences?: number;
  options?: { id: number; values: { id: number }[] }[];
  variants?: { id: number; combinationKey: string; values: LabelValues }[];
  /** Lines on open/future orders — what the holding queries match against. */
  holdingLines?: { serviceId: number; variantId: number | null }[];
  /** Variant ids ANY order line references (history included). */
  referencedVariantIds?: number[];
}

type VariantIdFilter = null | { not: null } | { in: number[] } | undefined;

/** Applies the reconcile's `variantId` filter shapes to the seeded holding lines. */
const matchesVariant = (variantId: number | null, filter: VariantIdFilter): boolean => {
  if (filter === null) {
    return variantId === null;
  }
  if (filter === undefined) {
    return true;
  }
  if ("in" in filter) {
    return variantId !== null && filter.in.includes(variantId);
  }
  return variantId !== null;
};

/** A mock Prisma transaction client seeded with the product's CURRENT rows. */
const makeTx = (state: TxState = {}) => {
  let nextOptionId = 100;
  let nextValueId = 200;
  return {
    product: {
      create: vi.fn().mockResolvedValue({ id: 7 }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    productImage: {
      findMany: vi.fn().mockResolvedValue(state.images ?? []),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    productDetail: {
      findMany: vi.fn().mockResolvedValue((state.detailIds ?? []).map((id) => ({ id }))),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    productOption: {
      findMany: vi.fn().mockResolvedValue(state.options ?? []),
      create: vi.fn().mockImplementation(() => Promise.resolve({ id: nextOptionId++ })),
      update: vi.fn().mockImplementation((args: { where: { id: number } }) =>
        Promise.resolve({ id: args.where.id }),
      ),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    productOptionValue: {
      create: vi.fn().mockImplementation(() => Promise.resolve({ id: nextValueId++ })),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    productVariant: {
      findMany: vi.fn().mockImplementation((args: { where: { id?: { in: number[] } } }) => {
        const variants = state.variants ?? [];
        const ids = args.where.id?.in;
        return Promise.resolve(
          ids ? variants.filter((variant) => ids.includes(variant.id)) : variants,
        );
      }),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    serviceDetail: {
      count: vi.fn().mockResolvedValue(state.orderReferences ?? 0),
      findMany: vi
        .fn()
        .mockImplementation(
          (args: { distinct?: string[]; where: { variantId?: VariantIdFilter } }) => {
            if (args.distinct) {
              return Promise.resolve(
                (state.referencedVariantIds ?? []).map((variantId) => ({ variantId })),
              );
            }
            return Promise.resolve(
              (state.holdingLines ?? []).filter((line) =>
                matchesVariant(line.variantId, args.where.variantId),
              ),
            );
          },
        ),
    },
  };
};
type MockTx = ReturnType<typeof makeTx>;

const HOLDING = { out: [2, 3, 4], window: [1] };

/** A body option: values carry their client key (and id when kept). */
const option = (
  name: string,
  values: { key: string; name: string; id?: number; images?: ProductOptionRequestModel["values"][number]["images"] }[],
  id?: number,
): ProductOptionRequestModel => ({
  ...(id !== undefined && { id }),
  name,
  values: values.map((value) => ({ images: [], ...value })),
});

/** A body variant (no overrides unless given). */
const variant = (
  valueKeys: string[],
  overrides: Partial<ProductVariantRequestModel> = {},
): ProductVariantRequestModel => ({
  valueKeys,
  quantity: 5,
  rentPrice: undefined,
  sellPrice: undefined,
  replacementPrice: undefined,
  securityDeposit: undefined,
  description: undefined,
  isDefault: false,
  ...overrides,
});

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
      securityDeposit: undefined,
      sellPrice: undefined,
      options: [],
      variants: [],
      ...body,
    },
    HOLDING,
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
        securityDeposit: null,
        rentTimeUnitId: null,
      },
    });
  });

  it("reconciles the gallery: kept rows update, absent rows delete (keys returned), new keys create", async () => {
    (getStorage as Mock).mockReturnValue({
      getPublicUrl: (key: string) => `https://cdn.test/${key}`,
    });
    const tx = makeTx({
      images: [
        { id: 11, r2Key: "products/keep.webp" },
        { id: 12, r2Key: "products/drop.webp" },
      ],
    });

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
      data: { sortOrder: 1, isPrimary: true, optionValueId: null },
    });
    // The new key is created with the SERVER-derived URL, never a client one.
    expect(tx.productImage.create).toHaveBeenCalledWith({
      data: {
        productId: 7,
        r2Key: "products/new.webp",
        url: "https://cdn.test/products/new.webp",
        sortOrder: 0,
        isPrimary: false,
        optionValueId: null,
      },
    });
    // Deletes run BEFORE creates so a key freed by this same save is immediately reusable.
    expect(
      tx.productImage.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.productImage.create.mock.invocationCallOrder[0]!);
    // Nothing about variations moved.
    expect(result.variantOutcome).toEqual({ retired: [], deleted: 0 });
  });

  it("never touches storage (or deleteMany) when the gallery only reorders kept photos", async () => {
    (getStorage as Mock).mockClear();
    const tx = makeTx({
      images: [
        { id: 11, r2Key: "products/a.webp" },
        { id: 12, r2Key: "products/b.webp" },
      ],
    });

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
      data: { sortOrder: 1, isPrimary: false, optionValueId: null },
    });
  });

  it("throws the conflict error when a kept image id vanished (a concurrent edit won)", async () => {
    const tx = makeTx({ images: [{ id: 11, r2Key: "products/a.webp" }] });
    await expect(
      runUpdate(tx, { images: [{ id: 99, isPrimary: true }] }),
    ).rejects.toBeInstanceOf(ProductStateConflictError);
    // Fail-fast: nothing gets deleted or written once the state mismatch is detected.
    expect(tx.productImage.deleteMany).not.toHaveBeenCalled();
    expect(tx.productImage.update).not.toHaveBeenCalled();
  });

  it("reconciles the details: kept rows update, absent rows delete, new rows create", async () => {
    const tx = makeTx({ detailIds: [21, 22] });

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
    const tx = makeTx({ detailIds: [21] });
    await runUpdate(tx, {
      productDetails: [{ id: 21, detailTypeId: 1, detail: "Blanco nieve" }],
    });
    expect(tx.productDetail.deleteMany).not.toHaveBeenCalled();
    expect(tx.productDetail.create).not.toHaveBeenCalled();
  });

  it("throws the conflict error when a kept detail id vanished", async () => {
    const tx = makeTx({ detailIds: [21] });
    await expect(
      runUpdate(tx, { productDetails: [{ id: 99, detailTypeId: 1, detail: "Blanco nieve" }] }),
    ).rejects.toBeInstanceOf(ProductStateConflictError);
    expect(tx.productDetail.deleteMany).not.toHaveBeenCalled();
    expect(tx.productDetail.update).not.toHaveBeenCalled();
  });
});

describe("applyProductUpdate — variations", () => {
  /** Color (Rojo 10, Azul 11) with variants 55 = Rojo and 56 = Azul — the usual current state. */
  const colorState = (extra: Partial<TxState> = {}): TxState => ({
    options: [{ id: 3, values: [{ id: 10 }, { id: 11 }] }],
    variants: [
      { id: 55, combinationKey: "10", values: labelValues("Rojo") },
      { id: 56, combinationKey: "11", values: labelValues("Azul") },
    ],
    ...extra,
  });
  const colorOption = (extraValues: Parameters<typeof option>[1] = []) =>
    option(
      "Color",
      [
        { id: 10, key: "v10", name: "Rojo" },
        { id: 11, key: "v11", name: "Azul" },
        ...extraValues,
      ],
      3,
    );

  it("adds variations to a product without them: options → values → value photos → variants", async () => {
    (getStorage as Mock).mockReturnValue({
      getPublicUrl: (key: string) => `https://cdn.test/${key}`,
    });
    const tx = makeTx();

    const result = await runUpdate(tx, {
      quantity: 0,
      options: [
        option("Color", [
          { key: "r", name: "Rojo" },
          { key: "a", name: "Azul", images: [{ key: "products/azul.webp", isPrimary: true }] },
        ]),
      ],
      variants: [
        variant(["r"], { quantity: 3 }),
        variant(["a"], { quantity: 2, isDefault: true, rentPrice: 60, securityDeposit: 0 }),
      ],
    });

    // The stock-mode guard looked for open lines on the product's OWN pool (variantId null).
    expect(tx.serviceDetail.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ productId: 7, variantId: null }) as unknown,
      select: { serviceId: true },
    });
    expect(tx.productOption.create).toHaveBeenCalledWith({
      data: { productId: 7, name: "Color", sortOrder: 0 },
      select: { id: true },
    });
    expect(tx.productOptionValue.create).toHaveBeenNthCalledWith(1, {
      data: { optionId: 100, name: "Rojo", sortOrder: 0 },
      select: { id: true },
    });
    expect(tx.productOptionValue.create).toHaveBeenNthCalledWith(2, {
      data: { optionId: 100, name: "Azul", sortOrder: 1 },
      select: { id: true },
    });
    // The value photo lands in ITS set (sortOrder from 0, own primary).
    expect(tx.productImage.create).toHaveBeenCalledWith({
      data: {
        productId: 7,
        r2Key: "products/azul.webp",
        url: "https://cdn.test/products/azul.webp",
        sortOrder: 0,
        isPrimary: true,
        optionValueId: 201,
      },
    });
    expect(tx.productVariant.create).toHaveBeenNthCalledWith(1, {
      data: {
        productId: 7,
        combinationKey: "200",
        rentPrice: null,
        sellPrice: null,
        replacementPrice: null,
        securityDeposit: null,
        description: null,
        quantity: 3,
        isDefault: false,
        values: { create: [{ optionValueId: 200 }] },
      },
    });
    expect(tx.productVariant.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        combinationKey: "201",
        rentPrice: 60,
        securityDeposit: 0,
        quantity: 2,
        isDefault: true,
      }) as unknown,
    });
    expect(result.variantOutcome).toEqual({ retired: [], deleted: 0 });
  });

  it("409 stockModeInUse: adding variations while open orders hold the product's own stock", async () => {
    const tx = makeTx({
      holdingLines: [
        { serviceId: 5, variantId: null },
        { serviceId: 5, variantId: null },
        { serviceId: 3, variantId: null },
      ],
    });
    const error = await runUpdate(tx, {
      options: [option("Color", [{ key: "r", name: "Rojo" }])],
      variants: [variant(["r"])],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProductStockModeInUseError);
    expect((error as ProductStockModeInUseError).orderIds).toEqual([3, 5]);
    expect(tx.productOption.create).not.toHaveBeenCalled();
  });

  it("409 stockModeInUse the other way: dropping every variation while orders hold a variant", async () => {
    const tx = makeTx(colorState({ holdingLines: [{ serviceId: 9, variantId: 56 }] }));
    const error = await runUpdate(tx, { quantity: 10 }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProductStockModeInUseError);
    expect((error as ProductStockModeInUseError).orderIds).toEqual([9]);
    expect(tx.productVariant.update).not.toHaveBeenCalled();
    expect(tx.productVariant.deleteMany).not.toHaveBeenCalled();
  });

  it("lets a mode switch through when only finished/cancelled orders used the old pool", async () => {
    // The holding query matches nothing → the switch proceeds; the variants just leave.
    const tx = makeTx(colorState({ referencedVariantIds: [55] }));
    const result = await runUpdate(tx, { quantity: 10 });

    expect(result.variantOutcome).toEqual({ retired: [{ id: 55, label: "Rojo" }], deleted: 1 });
    expect(tx.productOptionValue.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [10, 11] } },
    });
    expect(tx.productOption.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [3] } } });
  });

  it("409 variantInUse: removing a variant open orders still use lists it with its orders", async () => {
    const tx = makeTx({
      options: [{ id: 3, values: [{ id: 10 }, { id: 11 }, { id: 12 }] }],
      variants: [
        { id: 55, combinationKey: "10", values: labelValues("Rojo") },
        { id: 56, combinationKey: "11", values: labelValues("Azul") },
        { id: 57, combinationKey: "12", values: labelValues("Verde") },
      ],
      holdingLines: [
        { serviceId: 9, variantId: 56 },
        { serviceId: 4, variantId: 56 },
        { serviceId: 9, variantId: 55 },
      ],
    });
    const error = await runUpdate(tx, {
      quantity: 0,
      options: [colorOption([{ id: 12, key: "v12", name: "Verde" }])],
      variants: [variant(["v10"], { id: 55 })],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProductVariantInUseError);
    // Verde (57) leaves too but nothing holds it — only the blocked one is listed.
    expect((error as ProductVariantInUseError).conflicts).toEqual([
      { variantId: 56, label: "Azul", orderIds: [4, 9] },
    ]);
    expect(tx.productVariant.update).not.toHaveBeenCalled();
  });

  it("SWAPS two kept variants' combinations through the tmp: phase (ids, stock and holds stay)", async () => {
    const tx = makeTx(colorState());
    await runUpdate(tx, {
      quantity: 0,
      options: [colorOption()],
      variants: [variant(["v11"], { id: 55 }), variant(["v10"], { id: 56 })],
    });

    const updates = tx.productVariant.update.mock.calls.map(
      ([args]) => args as { where: { id: number }; data: Record<string, unknown> },
    );
    // Phase 1 parks BOTH on tmp:<id> before phase 2 writes either final key.
    expect(updates[0]).toEqual({ where: { id: 55 }, data: { combinationKey: "tmp:55" } });
    expect(updates[1]).toEqual({ where: { id: 56 }, data: { combinationKey: "tmp:56" } });
    expect(updates[2]).toMatchObject({
      where: { id: 55 },
      data: {
        combinationKey: "11",
        values: { deleteMany: {}, create: [{ optionValueId: 11 }] },
      },
    });
    expect(updates[3]).toMatchObject({
      where: { id: 56 },
      data: { combinationKey: "10", values: { deleteMany: {}, create: [{ optionValueId: 10 }] } },
    });
    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it("keeps an unchanged variant's join rows and writes its new overrides and stock", async () => {
    const tx = makeTx(colorState());
    await runUpdate(tx, {
      quantity: 0,
      options: [colorOption()],
      variants: [
        variant(["v10"], { id: 55, quantity: 8, rentPrice: 70, description: "Rojo vivo" }),
        variant(["v11"], { id: 56, isDefault: true }),
      ],
    });

    // No tmp: parking and no join-row replacement for an unchanged combination.
    expect(tx.productVariant.update).toHaveBeenCalledTimes(2);
    expect(tx.productVariant.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: {
        combinationKey: "10",
        rentPrice: 70,
        sellPrice: null,
        replacementPrice: null,
        securityDeposit: null,
        description: "Rojo vivo",
        quantity: 8,
        isDefault: false,
      },
    });
    // Kept option and values update their names and positions in place.
    expect(tx.productOption.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { name: "Color", sortOrder: 0 },
      select: { id: true },
    });
    expect(tx.productOptionValue.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { name: "Azul", sortOrder: 1 },
    });
    expect(tx.productOptionValue.deleteMany).not.toHaveBeenCalled();
    expect(tx.productOption.deleteMany).not.toHaveBeenCalled();
  });

  it("RETIRES a removed variant history references, deletes an unreferenced one, and re-adds a retired combination as a NEW row", async () => {
    const tx = makeTx({
      options: [{ id: 3, values: [{ id: 10 }, { id: 11 }, { id: 12 }] }],
      variants: [
        { id: 55, combinationKey: "10", values: labelValues("Rojo") },
        { id: 56, combinationKey: "11", values: labelValues("Azul") },
        { id: 57, combinationKey: "12", values: labelValues("Verde") },
      ],
      referencedVariantIds: [56],
    });

    const result = await runUpdate(tx, {
      quantity: 0,
      // Verde (12) is dropped with its only variant; Azul is re-offered as a fresh combination.
      options: [colorOption()],
      variants: [variant(["v10"], { id: 55 }), variant(["v11"], { quantity: 1 })],
    });

    expect(tx.productVariant.update).toHaveBeenCalledWith({
      where: { id: 56 },
      data: { isActive: false, isDefault: false, combinationKey: "retired:56" },
    });
    expect(tx.productVariant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [57] } } });
    // The retired row freed key "11" BEFORE the new row claims it.
    const tombstoneOrder = tx.productVariant.update.mock.invocationCallOrder[0]!;
    expect(tombstoneOrder).toBeLessThan(tx.productVariant.create.mock.invocationCallOrder[0]!);
    expect(tx.productVariant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: 7, combinationKey: "11", quantity: 1 }) as unknown,
    });
    expect(result.variantOutcome).toEqual({ retired: [{ id: 56, label: "Azul" }], deleted: 1 });
    // The removed value goes too (after its variant left).
    expect(tx.productOptionValue.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [12] } } });
    expect(tx.productOption.deleteMany).not.toHaveBeenCalled();
  });

  it("only RETIRES when every removed variant is referenced (no delete round-trip)", async () => {
    const tx = makeTx(colorState({ referencedVariantIds: [56] }));
    const result = await runUpdate(tx, {
      quantity: 0,
      options: [colorOption()],
      variants: [variant(["v10"], { id: 55 })],
    });
    expect(tx.productVariant.deleteMany).not.toHaveBeenCalled();
    expect(result.variantOutcome).toEqual({ retired: [{ id: 56, label: "Azul" }], deleted: 0 });
  });

  it("moves a kept photo between sets and adds a value under a NEW option", async () => {
    const tx = makeTx({
      ...colorState(),
      images: [{ id: 31, r2Key: "products/rojo.webp" }],
    });
    await runUpdate(tx, {
      quantity: 0,
      options: [
        colorOption(),
        option("Tamaño", [{ key: "g", name: "Grande", images: [{ id: 31, isPrimary: true }] }]),
      ],
      variants: [variant(["v10", "g"], { id: 55 }), variant(["v11", "g"], { id: 56 })],
    });

    expect(tx.productOption.create).toHaveBeenCalledWith({
      data: { productId: 7, name: "Tamaño", sortOrder: 1 },
      select: { id: true },
    });
    // The photo now belongs to Grande (the new value 200), first slot, primary.
    expect(tx.productImage.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: { sortOrder: 0, isPrimary: true, optionValueId: 200 },
    });
    expect(tx.productImage.deleteMany).not.toHaveBeenCalled();
    // Both kept variants changed combination → parked, then re-keyed with new join rows.
    expect(tx.productVariant.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: expect.objectContaining({
        combinationKey: "10.200",
        values: { deleteMany: {}, create: [{ optionValueId: 10 }, { optionValueId: 200 }] },
      }) as unknown,
    });
  });

  it("throws the conflict error for a kept option, value or variant that no longer exists", async () => {
    await expect(
      runUpdate(makeTx(colorState()), {
        quantity: 0,
        options: [option("Color", [{ id: 10, key: "v10", name: "Rojo" }], 99)],
        variants: [variant(["v10"], { id: 55 })],
      }),
    ).rejects.toBeInstanceOf(ProductStateConflictError);
    // A kept value sent under ANOTHER (new) option is a mismatch too.
    await expect(
      runUpdate(makeTx(colorState()), {
        quantity: 0,
        options: [option("Color", [{ id: 10, key: "v10", name: "Rojo" }])],
        variants: [variant(["v10"], { id: 55 })],
      }),
    ).rejects.toBeInstanceOf(ProductStateConflictError);
    const tx = makeTx(colorState());
    await expect(
      runUpdate(tx, {
        quantity: 0,
        options: [colorOption()],
        variants: [variant(["v10"], { id: 77 })],
      }),
    ).rejects.toBeInstanceOf(ProductStateConflictError);
    expect(tx.productOption.update).not.toHaveBeenCalled();
  });
});

describe("applyProductCreate", () => {
  const createBody = (overrides: Partial<CreateProductRequestModel> = {}): CreateProductRequestModel => ({
    businessTypeId: 1,
    categoryId: 1,
    currencyId: 1,
    description: undefined,
    images: [],
    name: "Mantel",
    productDetails: [],
    quantity: 12,
    options: [],
    variants: [],
    rentPrice: 20,
    rentTimeUnitId: 2,
    replacementPrice: undefined,
    securityDeposit: undefined,
    sellPrice: undefined,
    ...overrides,
  });
  const run = (tx: MockTx, body: CreateProductRequestModel) =>
    applyProductCreate(tx as unknown as Parameters<typeof applyProductCreate>[0], body);

  it("creates a plain product with its details and showcase photos, and returns its id", async () => {
    (getStorage as Mock).mockReturnValue({
      getPublicUrl: (key: string) => `https://cdn.test/${key}`,
    });
    const tx = makeTx();
    const id = await run(
      tx,
      createBody({
        productDetails: [{ detailTypeId: 1, detail: "Blanco" }],
        images: [{ key: "products/k1.webp", isPrimary: false }, { key: "products/k2.jpg", isPrimary: true }],
      }),
    );

    expect(id).toBe(7);
    expect(tx.product.create).toHaveBeenCalledWith({
      data: {
        name: "Mantel",
        description: null,
        productBusinessTypeId: 1,
        productCategoryId: 1,
        currencyId: 1,
        quantity: 12,
        rentPrice: 20,
        sellPrice: null,
        replacementPrice: null,
        securityDeposit: null,
        rentTimeUnitId: 2,
        productDetails: { create: [{ productDetailTypeId: 1, detail: "Blanco" }] },
      },
      select: { id: true },
    });
    expect(tx.productImage.create).toHaveBeenNthCalledWith(2, {
      data: {
        productId: 7,
        r2Key: "products/k2.jpg",
        url: "https://cdn.test/products/k2.jpg",
        sortOrder: 1,
        isPrimary: true,
        optionValueId: null,
      },
    });
    expect(tx.productOption.create).not.toHaveBeenCalled();
    expect(tx.productVariant.create).not.toHaveBeenCalled();
    // A create never runs the update's guards.
    expect(tx.serviceDetail.findMany).not.toHaveBeenCalled();
  });

  it("omits the nested details create and never touches storage without photos", async () => {
    (getStorage as Mock).mockClear();
    const tx = makeTx();
    await run(tx, createBody());
    expect(tx.product.create.mock.calls[0]?.[0]).not.toHaveProperty("data.productDetails");
    expect(getStorage).not.toHaveBeenCalled();
  });

  it("writes the variation structure through the same writers as the update", async () => {
    const tx = makeTx();
    await run(
      tx,
      createBody({
        quantity: 0,
        options: [
          option("Color", [{ key: "r", name: "Rojo" }]),
          option("Tamaño", [{ key: "g", name: "Grande" }]),
        ],
        variants: [variant(["r", "g"], { isDefault: true })],
      }),
    );
    expect(tx.productOption.create).toHaveBeenCalledTimes(2);
    // Rojo = 200 (option 100), Grande = 201 (option 101) → key sorted numerically.
    expect(tx.productVariant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: 7,
        combinationKey: "200.201",
        values: { create: [{ optionValueId: 200 }, { optionValueId: 201 }] },
      }) as unknown,
    });
  });
});

describe("loadVariantUsage", () => {
  it("counts every referencing line and the HOLDING ones per variant", async () => {
    const groupBy = vi
      .fn()
      .mockResolvedValueOnce([
        { variantId: 55, _count: { _all: 4 } },
        { variantId: 56, _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([{ variantId: 55, _count: { _all: 2 } }]);
    const usage = await loadVariantUsage(
      { serviceDetail: { groupBy } } as unknown as Parameters<typeof loadVariantUsage>[0],
      7,
      HOLDING,
    );

    expect(usage).toEqual(
      new Map([
        [55, { lines: 4, holding: 2 }],
        [56, { lines: 1, holding: 0 }],
      ]),
    );
    expect(groupBy).toHaveBeenNthCalledWith(1, {
      by: ["variantId"],
      where: { productId: 7, variantId: { not: null } },
      _count: { _all: true },
    });
    expect(groupBy.mock.calls[1]?.[0]).toMatchObject({
      where: { productId: 7, variantId: { not: null }, isActive: true },
    });
  });
});

describe("the variation 409 errors", () => {
  it("carry their payloads for the controller", () => {
    const inUse = new ProductVariantInUseError([{ variantId: 56, label: "Azul", orderIds: [9] }]);
    expect(inUse.name).toBe("ProductVariantInUseError");
    expect(inUse.message).toContain("56");
    const mode = new ProductStockModeInUseError([3, 5]);
    expect(mode.name).toBe("ProductStockModeInUseError");
    expect(mode.orderIds).toEqual([3, 5]);
  });
});

describe("applyProductDelete (the no-trash policy)", () => {
  const run = (tx: MockTx) =>
    applyProductDelete(tx as unknown as Parameters<typeof applyProductDelete>[0], 7);

  it("HARD-deletes a product no order ever referenced, sweeping details + images + variations", async () => {
    const tx = makeTx({
      images: [
        { id: 11, r2Key: "products/a.webp" },
        { id: 12, r2Key: "products/b.webp" },
      ],
      detailIds: [21],
    });

    const result = await run(tx);

    expect(tx.productImage.deleteMany).toHaveBeenCalledWith({ where: { productId: 7 } });
    expect(tx.productDetail.deleteMany).toHaveBeenCalledWith({ where: { productId: 7 } });
    // No variant is referenced → every variant row goes, then the values and the options.
    expect(tx.productVariant.update).not.toHaveBeenCalled();
    expect(tx.productVariant.deleteMany).toHaveBeenCalledWith({
      where: { productId: 7, id: { notIn: [] } },
    });
    expect(tx.productOptionValue.deleteMany).toHaveBeenCalledWith({
      where: { option: { productId: 7 } },
    });
    expect(tx.productOption.deleteMany).toHaveBeenCalledWith({ where: { productId: 7 } });
    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(tx.product.update).not.toHaveBeenCalled();
    // Every R2 key surfaces for the post-commit BATCHED cleanup.
    expect(result).toEqual({
      removedImageKeys: ["products/a.webp", "products/b.webp"],
      hardDeleted: true,
    });
  });

  it("SOFT-deletes (tombstones) only when order history references the product", async () => {
    const tx = makeTx({ images: [{ id: 11, r2Key: "products/a.webp" }], orderReferences: 3 });

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

  it("tombstones the variants order lines reference and deletes the rest", async () => {
    const tx = makeTx({
      ...{
        variants: [
          { id: 55, combinationKey: "10", values: labelValues("Rojo") },
          { id: 56, combinationKey: "11", values: labelValues("Azul") },
        ],
      },
      referencedVariantIds: [55],
      orderReferences: 2,
    });

    await run(tx);

    expect(tx.productVariant.findMany).toHaveBeenCalledWith({
      where: { productId: 7, isActive: true, id: { in: [55] } },
      select: { id: true },
    });
    expect(tx.productVariant.update).toHaveBeenCalledTimes(1);
    expect(tx.productVariant.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: { isActive: false, isDefault: false, combinationKey: "retired:55" },
    });
    expect(tx.productVariant.deleteMany).toHaveBeenCalledWith({
      where: { productId: 7, id: { notIn: [55] } },
    });
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { isActive: false } });
  });

  it("handles an image-less product (no keys to clean up)", async () => {
    const tx = makeTx();
    const result = await run(tx);
    expect(result.removedImageKeys).toEqual([]);
    expect(tx.product.delete).toHaveBeenCalled();
  });
});

describe("isSqlProductSort", () => {
  it("routes the catalog arrangement and newest-first to SQL, everything else in memory", () => {
    expect(isSqlProductSort("catalog")).toBe(true);
    expect(isSqlProductSort("recent")).toBe(true);
    expect(isSqlProductSort("nameAsc")).toBe(false);
    expect(isSqlProductSort("priceDesc")).toBe(false);
  });
});

describe("projectArrangementItem", () => {
  const row = (overrides: Partial<ArrangementRow> = {}): ArrangementRow => ({
    id: 7,
    name: "Mesa redonda",
    displayOrder: 3,
    category: { name: "Mesas" },
    businessType: { name: "Alquiler" },
    productImages: [
      { url: "https://cdn.test/first.webp", isPrimary: false },
      { url: "https://cdn.test/primary.webp", isPrimary: true },
    ],
    options: [],
    variants: [],
    ...overrides,
  });

  it("uses the DEFAULT variant's photo for a product without showcase photos (the cover rule)", () => {
    const tile = projectArrangementItem(
      row({
        productImages: [],
        options: variationOptions,
        variants: [
          { id: 55, isDefault: false, values: [{ optionValueId: 10 }, { optionValueId: 20 }] },
          { id: 56, isDefault: true, values: [{ optionValueId: 11 }, { optionValueId: 20 }] },
        ],
      }),
    );
    expect(tile.imageUrl).toBe("https://cdn.test/grande.webp");
  });

  it("shows the FLAGGED primary photo, wherever it sits in the gallery", () => {
    expect(projectArrangementItem(row())).toEqual({
      id: 7,
      name: "Mesa redonda",
      category: "Mesas",
      businessType: "Alquiler",
      imageUrl: "https://cdn.test/primary.webp",
      placed: true,
    });
  });

  it("falls back to the first photo, and omits the url for a photo-less product", () => {
    expect(
      projectArrangementItem(
        row({ productImages: [{ url: "https://cdn.test/only.webp", isPrimary: false }] }),
      ).imageUrl,
    ).toBe("https://cdn.test/only.webp");
    expect(projectArrangementItem(row({ productImages: [] }))).not.toHaveProperty("imageUrl");
  });

  it("reports display_order 0 as not placed (a new product that leads the grid)", () => {
    expect(projectArrangementItem(row({ displayOrder: 0 })).placed).toBe(false);
  });
});

describe("applyProductDisplayOrder", () => {
  const makeOrderTx = (current: { id: number; displayOrder: number }[]) => ({
    product: {
      findMany: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue({}),
    },
  });
  const run = (tx: ReturnType<typeof makeOrderTx>, ids: number[]) =>
    applyProductDisplayOrder(tx as unknown as Parameters<typeof applyProductDisplayOrder>[0], ids);

  it("renumbers 1..N and writes ONLY the rows whose position changed", async () => {
    const tx = makeOrderTx([
      { id: 1, displayOrder: 1 },
      { id: 2, displayOrder: 2 },
      { id: 3, displayOrder: 0 },
    ]);

    await run(tx, [1, 3, 2]);

    expect(tx.product.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, displayOrder: true },
    });
    expect(tx.product.update).toHaveBeenCalledTimes(2);
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { displayOrder: 2 } });
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { displayOrder: 3 } });
  });

  it("rejects a list that is missing an active product (one was created meanwhile)", async () => {
    const tx = makeOrderTx([
      { id: 1, displayOrder: 0 },
      { id: 2, displayOrder: 0 },
    ]);
    await expect(run(tx, [1])).rejects.toBeInstanceOf(ProductDisplayOrderConflictError);
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it("rejects a list naming a product that is no longer active (deleted meanwhile)", async () => {
    const tx = makeOrderTx([{ id: 1, displayOrder: 0 }]);
    await expect(run(tx, [9])).rejects.toBeInstanceOf(ProductDisplayOrderConflictError);
    expect(tx.product.update).not.toHaveBeenCalled();
  });
});

