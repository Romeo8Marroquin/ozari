import { describe, it, expect, vi } from "vitest";
import { appConfig } from "@/config/app.js";
import {
  buildProductImageKeyRegex,
  normalizeVariationName,
  parseProductVariations,
  sanitizeOptionalMoney,
  securityDepositViolation,
  type ExistingProductVariations,
  type ProductVariationsBody,
} from "./products.variations.js";

/** A key exactly as the upload-url endpoint mints them (uuid v4 + whitelisted extension). */
const imageKey = (n: number) =>
  `products/00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}.webp`;

/** An Alquiler body with NO variations — tests add what they exercise. */
const body = (overrides: Partial<ProductVariationsBody> = {}): ProductVariationsBody => ({
  options: undefined,
  variants: undefined,
  quantity: undefined,
  sharedStock: undefined,
  isRent: true,
  rentPrice: 50,
  sellPrice: undefined,
  replacementPrice: 900,
  securityDeposit: 300,
  showcaseImages: [],
  ...overrides,
});

/** Color (Rojo r, Azul a) × Tamaño (Grande g) — the usual valid structure (no ids). */
const colorAndSize = () => [
  { name: "Color", values: [{ key: "r", name: "Rojo" }, { key: "a", name: "Azul" }] },
  { name: "Tamaño", values: [{ key: "g", name: "Grande" }] },
];

/** The product as the update validator reads it: option 3 (values 10, 11), option 4 (value 20). */
const existing: ExistingProductVariations = {
  imageIds: [31, 32, 33],
  options: [
    { id: 3, values: [{ id: 10 }, { id: 11 }] },
    { id: 4, values: [{ id: 20 }] },
  ],
  activeVariantIds: [55, 56],
};

const parse = (input: ProductVariationsBody, current: ExistingProductVariations | null = null) => {
  const reject = vi.fn();
  const result = parseProductVariations(input, current, reject);
  return {
    result,
    reject,
    rejectedWith: reject.mock.calls[0]?.[0] as string | undefined,
  };
};

/** Expects exactly ONE rejection with `key` (and a null result). */
const expectRejected = (
  input: ProductVariationsBody,
  key: string,
  current: ExistingProductVariations | null = null,
) => {
  const { result, reject, rejectedWith } = parse(input, current);
  expect(result).toBeNull();
  expect(reject).toHaveBeenCalledTimes(1);
  expect(rejectedWith).toBe(key);
};

/** A body WITH the usual structure and the given variants. */
const withVariants = (variants: unknown, overrides: Partial<ProductVariationsBody> = {}) =>
  body({ options: colorAndSize(), variants, ...overrides });

describe("shared product rules", () => {
  it("matches only keys our presign flow mints", () => {
    const regex = buildProductImageKeyRegex();
    expect(regex.test(imageKey(1))).toBe(true);
    expect(regex.test("products/../../etc/passwd")).toBe(false);
    expect(regex.test(imageKey(1).replace(".webp", ".svg"))).toBe(false);
  });

  it("sanitizes optional money: absent stays absent, bad values fail, cents truncate", () => {
    expect(sanitizeOptionalMoney(undefined)).toEqual({ ok: true, value: undefined });
    expect(sanitizeOptionalMoney(null)).toEqual({ ok: true, value: undefined });
    expect(sanitizeOptionalMoney(10.999)).toEqual({ ok: true, value: 10.99 });
    expect(sanitizeOptionalMoney(0)).toEqual({ ok: true, value: 0 });
    for (const bad of ["10", Number.NaN, -1, appConfig.maxGlobalAmount + 1]) {
      expect(sanitizeOptionalMoney(bad)).toEqual({ ok: false });
    }
  });

  it("applies the deposit rule: Alquiler only, never above the replacement", () => {
    expect(securityDepositViolation(true, undefined, 100)).toBeUndefined();
    expect(securityDepositViolation(false, 10, undefined)).toBe("securityDepositForbidden");
    expect(securityDepositViolation(true, 200, 100)).toBe("securityDepositAboveReplacement");
    expect(securityDepositViolation(true, 100, 100)).toBeUndefined();
    expect(securityDepositViolation(true, 100, undefined)).toBeUndefined();
  });

  it("normalizes names case-, accent- and spacing-insensitively", () => {
    expect(normalizeVariationName("  Tamaño   Grande ")).toBe("tamano grande");
    expect(normalizeVariationName("ROJO")).toBe(normalizeVariationName("rojo"));
  });
});

describe("parseProductVariations — structure", () => {
  it("returns no variations when both lists are absent or null", () => {
    expect(parse(body()).result).toEqual({ options: [], variants: [], sharedStock: false });
    expect(
      parse(body({ options: null, variants: null, quantity: 4, sharedStock: null })).result,
    ).toEqual({
      options: [],
      variants: [],
      sharedStock: false,
    });
  });

  it("parses a full create body: canonical value keys, photo primaries, sanitized overrides", () => {
    const { result, reject } = parse(
      body({
        showcaseImages: [{ key: imageKey(1) }],
        options: [
          {
            name: "  Color ",
            values: [
              {
                key: "r",
                name: " Rojo ",
                images: [{ key: imageKey(2) }, { key: imageKey(3), isPrimary: true }],
              },
              { key: "a", name: "Azul", images: [{ key: imageKey(4) }, { key: imageKey(5) }] },
            ],
          },
          { name: "Tamaño", values: [{ key: "g", name: "Grande" }] },
        ],
        variants: [
          // Keys arrive in ANY order → canonicalized into option order.
          {
            valueKeys: ["g", "r"],
            quantity: 3,
            rentPrice: 60.999,
            securityDeposit: 0,
            description: "  Rojo intenso ",
            isDefault: true,
          },
          { valueKeys: ["a", "g"], quantity: 0, description: "", isDefault: null },
        ],
      }),
    );

    expect(reject).not.toHaveBeenCalled();
    expect(result).toEqual({
      sharedStock: false,
      options: [
        {
          name: "Color",
          kind: "generic",
          values: [
            {
              key: "r",
              name: "Rojo",
              images: [
                { key: imageKey(2), isPrimary: false },
                { key: imageKey(3), isPrimary: true },
              ],
            },
            {
              key: "a",
              name: "Azul",
              // No flagged primary → the FIRST photo of the set.
              images: [
                { key: imageKey(4), isPrimary: true },
                { key: imageKey(5), isPrimary: false },
              ],
            },
          ],
        },
        { name: "Tamaño", kind: "generic", values: [{ key: "g", name: "Grande", images: [] }] },
      ],
      variants: [
        {
          valueKeys: ["r", "g"],
          quantity: 3,
          rentPrice: 60.99,
          sellPrice: undefined,
          replacementPrice: undefined,
          securityDeposit: 0,
          description: "Rojo intenso",
          isDefault: true,
        },
        {
          valueKeys: ["a", "g"],
          quantity: 0,
          rentPrice: undefined,
          sellPrice: undefined,
          replacementPrice: undefined,
          securityDeposit: undefined,
          description: undefined,
          isDefault: false,
        },
      ],
    });
  });

  it("keeps ids on update — options, values, photos from ANY set, active variants", () => {
    const { result, reject } = parse(
      body({
        showcaseImages: [{ id: 31 }],
        options: [
          {
            id: 3,
            name: "Color",
            values: [
              { id: 10, key: "v10", name: "Rojo", images: [{ id: 32 }] },
              { id: 11, key: "v11", name: "Azul" },
              { key: "n1", name: "Verde", images: [{ id: 33, isPrimary: true }] },
            ],
          },
        ],
        variants: [
          { id: 55, valueKeys: ["v10"], quantity: 1 },
          { valueKeys: ["n1"], quantity: 2 },
        ],
      }),
      existing,
    );
    expect(reject).not.toHaveBeenCalled();
    expect(result?.options[0]).toMatchObject({
      id: 3,
      values: [
        { id: 10, images: [{ id: 32, isPrimary: true }] },
        { id: 11, images: [] },
        { key: "n1", images: [{ id: 33, isPrimary: true }] },
      ],
    });
    expect(result?.variants.map((variant) => variant.id)).toEqual([55, undefined]);
  });

  it("rejects a non-array options list and more options than the cap", () => {
    expectRejected(body({ options: "Color" }), "invalidOptions");
    expectRejected(
      body({
        options: Array.from({ length: appConfig.maxProductOptions + 1 }, (_, index) => ({
          name: `Eje ${index}`,
          values: [{ key: `k${index}`, name: "Uno" }],
        })),
      }),
      "tooManyOptions",
    );
  });

  it("forbids a product-level quantity once options exist (stock lives on each variant)", () => {
    expectRejected(withVariants([{ valueKeys: ["r", "g"], quantity: 1 }], { quantity: 5 }), "quantityWithVariants");
  });

  it("forbids every id on create", () => {
    expectRejected(body({ options: [{ id: 3, name: "Color", values: [{ key: "r", name: "Rojo" }] }] }), "idsForbiddenOnCreate");
    expectRejected(
      body({ options: [{ name: "Color", values: [{ id: 10, key: "r", name: "Rojo" }] }] }),
      "idsForbiddenOnCreate",
    );
    expectRejected(
      body({ options: [{ name: "Color", values: [{ key: "r", name: "Rojo", images: [{ id: 31 }] }] }] }),
      "idsForbiddenOnCreate",
    );
    expectRejected(withVariants([{ id: 55, valueKeys: ["r", "g"], quantity: 1 }]), "idsForbiddenOnCreate");
  });
});

describe("parseProductVariations — options and values", () => {
  it("rejects an option id that is not this product's, or repeated", () => {
    const option = (id: unknown) => ({ id, name: "Color", values: [{ key: "x", name: "Rojo" }] });
    expectRejected(body({ options: [option(99)] }), "invalidOptionId", existing);
    expectRejected(body({ options: [option("3")] }), "invalidOptionId", existing);
    expectRejected(
      body({ options: [option(3), { ...option(3), name: "Otro", values: [{ key: "y", name: "Uno" }] }] }),
      "invalidOptionId",
      existing,
    );
  });

  it("rejects an invalid or duplicate option name (case/accent-insensitive)", () => {
    for (const name of [undefined, 5, "", "   ", "x".repeat(41), "Color!"]) {
      expectRejected(body({ options: [{ name, values: [{ key: "r", name: "Rojo" }] }] }), "invalidOptionName");
    }
    expectRejected(
      body({
        options: [
          { name: "Tamaño", values: [{ key: "a", name: "Uno" }] },
          { name: " tamano ", values: [{ key: "b", name: "Dos" }] },
        ],
      }),
      "duplicateOptionName",
    );
  });

  it("accepts a one-character option/value name (the 1–40 range, unlike full names)", () => {
    const { reject } = parse(
      body({ options: [{ name: "T", values: [{ key: "x", name: "S" }] }], variants: [{ valueKeys: ["x"], quantity: 1 }] }),
    );
    expect(reject).not.toHaveBeenCalled();
  });

  it("requires 1..maxOptionValues values per option", () => {
    expectRejected(body({ options: [{ name: "Color" }] }), "invalidOptionValues");
    expectRejected(body({ options: [{ name: "Color", values: [] }] }), "invalidOptionValues");
    expectRejected(
      body({
        options: [
          {
            name: "Color",
            values: Array.from({ length: appConfig.maxOptionValues + 1 }, (_, index) => ({
              key: `k${index}`,
              name: `Valor ${index}`,
            })),
          },
        ],
      }),
      "tooManyOptionValues",
    );
  });

  it("rejects a value id that is not this product's or is repeated", () => {
    expectRejected(
      body({ options: [{ id: 3, name: "Color", values: [{ id: 99, key: "x", name: "Rojo" }] }] }),
      "invalidValueId",
      existing,
    );
    expectRejected(
      body({
        options: [
          {
            id: 3,
            name: "Color",
            values: [
              { id: 10, key: "x", name: "Rojo" },
              { id: 10, key: "y", name: "Azul" },
            ],
          },
        ],
      }),
      "invalidValueId",
      existing,
    );
  });

  it("rejects MOVING a value to another option — kept or brand-new", () => {
    expectRejected(
      body({ options: [{ id: 4, name: "Tamaño", values: [{ id: 10, key: "x", name: "Rojo" }] }] }),
      "valueMovedOption",
      existing,
    );
    expectRejected(
      body({ options: [{ name: "Nuevo", values: [{ id: 10, key: "x", name: "Rojo" }] }] }),
      "valueMovedOption",
      existing,
    );
  });

  it("rejects an invalid or duplicate value key (keys are unique across the WHOLE body)", () => {
    for (const key of [undefined, 7, "", "a b", "x".repeat(41)]) {
      expectRejected(body({ options: [{ name: "Color", values: [{ key, name: "Rojo" }] }] }), "invalidValueKey");
    }
    expectRejected(
      body({
        options: [
          { name: "Color", values: [{ key: "k", name: "Rojo" }] },
          { name: "Tamaño", values: [{ key: "k", name: "Grande" }] },
        ],
      }),
      "duplicateValueKey",
    );
  });

  it("rejects an invalid value name and a duplicate within ONE option (another option may reuse it)", () => {
    expectRejected(body({ options: [{ name: "Color", values: [{ key: "r", name: "" }] }] }), "invalidValueName");
    expectRejected(
      body({
        options: [
          {
            name: "Color",
            values: [
              { key: "r", name: "Rojo" },
              { key: "s", name: "ROJO" },
            ],
          },
        ],
      }),
      "duplicateValueName",
    );
    const { reject } = parse(
      body({
        options: [
          { name: "Color", values: [{ key: "a", name: "Uno" }] },
          { name: "Tamaño", values: [{ key: "b", name: "Uno" }] },
        ],
        variants: [{ valueKeys: ["a", "b"], quantity: 1 }],
      }),
    );
    expect(reject).not.toHaveBeenCalled();
  });
});

describe("parseProductVariations — value photos", () => {
  const withImages = (images: unknown, showcaseImages: ProductVariationsBody["showcaseImages"] = []) =>
    body({ showcaseImages, options: [{ name: "Color", values: [{ key: "r", name: "Rojo", images }] }] });

  it("rejects a non-array set and more photos than the per-value cap", () => {
    expectRejected(withImages("x"), "invalidValueImages");
    expectRejected(
      withImages(
        Array.from({ length: appConfig.storage.maxImagesPerOptionValue + 1 }, (_, index) => ({
          key: imageKey(index + 1),
        })),
      ),
      "tooManyValueImages",
    );
  });

  it("requires exactly one of id or key per slot", () => {
    expectRejected(withImages([{ id: 31, key: imageKey(1) }]), "invalidImageEntry");
    expectRejected(withImages([{ isPrimary: true }]), "invalidImageEntry");
    expectRejected(withImages([null]), "invalidImageEntry");
  });

  it("rejects a photo id that is not this product's or is already used (showcase included)", () => {
    expectRejected(withImages([{ id: 99 }]), "invalidImageId", existing);
    expectRejected(withImages([{ id: "31" }]), "invalidImageId", existing);
    expectRejected(withImages([{ id: 31 }], [{ id: 31 }]), "invalidImageId", existing);
  });

  it("rejects a key we did not mint, or one used anywhere else in the body", () => {
    expectRejected(withImages([{ key: 5 }]), "invalidImageKey");
    expectRejected(withImages([{ key: "products/evil.webp" }]), "invalidImageKey");
    expectRejected(withImages([{ key: imageKey(1) }], [{ key: imageKey(1) }]), "duplicateImageKey");
    expectRejected(withImages([{ key: imageKey(1) }, { key: imageKey(1) }]), "duplicateImageKey");
  });

  it("allows at most one primary per set", () => {
    expectRejected(
      withImages([
        { key: imageKey(1), isPrimary: true },
        { key: imageKey(2), isPrimary: true },
      ]),
      "multiplePrimaryImages",
    );
  });

  it("caps the photos of the WHOLE product (showcase + every value set)", () => {
    const perValue = appConfig.storage.maxImagesPerOptionValue;
    const showcase = Array.from({ length: appConfig.storage.maxImagesPerProduct }, (_, index) => ({
      key: imageKey(index + 1),
    }));
    let next = 100;
    // Enough full value sets to cross the total cap by exactly one set.
    const valueCount =
      Math.floor((appConfig.storage.maxImagesTotalPerProduct - showcase.length) / perValue) + 1;
    const values = Array.from({ length: valueCount }, (_, index) => ({
      key: `k${index}`,
      name: `Valor ${index}`,
      images: Array.from({ length: perValue }, () => ({ key: imageKey(next++) })),
    }));
    // Spread over as many options as the per-option value cap needs, so only the TOTAL can trip.
    const perOption = appConfig.maxOptionValues;
    const options = Array.from({ length: Math.ceil(values.length / perOption) }, (_, index) => ({
      name: `Opcion ${index}`,
      values: values.slice(index * perOption, (index + 1) * perOption),
    }));
    expect(options.length).toBeLessThanOrEqual(appConfig.maxProductOptions);
    expectRejected(body({ showcaseImages: showcase, options }), "tooManyImagesTotal");
  });
});

describe("parseProductVariations — variants", () => {
  it("rejects a non-array list, variants without options, and options without variants", () => {
    expectRejected(withVariants("all"), "invalidVariants");
    expectRejected(body({ variants: [{ valueKeys: [], quantity: 1 }] }), "variantsWithoutOptions");
    expectRejected(withVariants(undefined), "variantsRequired");
    expectRejected(withVariants([]), "variantsRequired");
  });

  it("caps the variant count", () => {
    expectRejected(
      withVariants(Array.from({ length: appConfig.maxProductVariants + 1 }, () => ({}))),
      "tooManyVariants",
    );
  });

  it("rejects a variant id that is not an ACTIVE variant of this product, or repeated", () => {
    const update = (variants: unknown) =>
      body({
        options: [{ id: 3, name: "Color", values: [{ id: 10, key: "v10", name: "Rojo" }, { id: 11, key: "v11", name: "Azul" }] }],
        variants,
      });
    // 57 = a retired (or foreign) variant: a tombstone is never revived.
    expectRejected(update([{ id: 57, valueKeys: ["v10"], quantity: 1 }]), "invalidVariantId", existing);
    expectRejected(
      update([
        { id: 55, valueKeys: ["v10"], quantity: 1 },
        { id: 55, valueKeys: ["v11"], quantity: 1 },
      ]),
      "invalidVariantId",
      existing,
    );
  });

  it("requires exactly one known value key per option", () => {
    for (const valueKeys of [undefined, ["r"], ["r", "g", "a"], ["r", "zz"], ["r", "a"], [1, "g"]]) {
      expectRejected(withVariants([{ valueKeys, quantity: 1 }]), "invalidVariantValues");
    }
  });

  it("rejects two variants with the same combination, whatever the key order", () => {
    expectRejected(
      withVariants([
        { valueKeys: ["r", "g"], quantity: 1 },
        { valueKeys: ["g", "r"], quantity: 2 },
      ]),
      "duplicateVariantCombination",
    );
  });

  it("allows at most one default variant", () => {
    expectRejected(
      withVariants([
        { valueKeys: ["r", "g"], quantity: 1, isDefault: true },
        { valueKeys: ["a", "g"], quantity: 1, isDefault: true },
      ]),
      "multipleDefaultVariants",
    );
  });

  it("requires an integer stock within [0, maxGlobalQuantity]", () => {
    for (const quantity of [undefined, "3", -1, 1.5, appConfig.maxGlobalQuantity + 1]) {
      expectRejected(withVariants([{ valueKeys: ["r", "g"], quantity }]), "invalidVariantQuantity");
    }
  });

  it("rejects an invalid override amount", () => {
    for (const rentPrice of [-1, "60", Number.NaN]) {
      expectRejected(withVariants([{ valueKeys: ["r", "g"], quantity: 1, rentPrice }]), "invalidVariantPrice");
    }
  });

  it("makes the overrides follow the business type (Alquiler: rent/replacement/deposit; Venta: sell)", () => {
    expectRejected(withVariants([{ valueKeys: ["r", "g"], quantity: 1, sellPrice: 10 }]), "variantPricingMismatch");
    const sale = { isRent: false, replacementPrice: undefined, securityDeposit: undefined };
    for (const field of ["rentPrice", "replacementPrice", "securityDeposit"]) {
      expectRejected(
        withVariants([{ valueKeys: ["r", "g"], quantity: 1, [field]: 10 }], sale),
        "variantPricingMismatch",
      );
    }
    const { result } = parse(withVariants([{ valueKeys: ["r", "g"], quantity: 1, sellPrice: 15 }], sale));
    expect(result?.variants[0]?.sellPrice).toBe(15);
  });

  it("checks the deposit ceiling on EFFECTIVE values (override, else the product's)", () => {
    // Override deposit above the product's replacement (900).
    expectRejected(
      withVariants([{ valueKeys: ["r", "g"], quantity: 1, securityDeposit: 950 }]),
      "variantSecurityDepositAboveReplacement",
    );
    // The product's deposit (300) above an override replacement.
    expectRejected(
      withVariants([{ valueKeys: ["r", "g"], quantity: 1, replacementPrice: 200 }]),
      "variantSecurityDepositAboveReplacement",
    );
    // Deposit 0 = explicitly none — always under the ceiling; no replacement anywhere = no ceiling.
    const { reject } = parse(
      withVariants(
        [
          { valueKeys: ["r", "g"], quantity: 1, securityDeposit: 0, replacementPrice: 200 },
          { valueKeys: ["a", "g"], quantity: 1, securityDeposit: 5000 },
        ],
        { replacementPrice: undefined },
      ),
    );
    expect(reject).not.toHaveBeenCalled();
  });

  it("validates the description (5–500, the description charset) and the default flag", () => {
    for (const description of [5, "abc", "x".repeat(501), "<script>"]) {
      expectRejected(withVariants([{ valueKeys: ["r", "g"], quantity: 1, description }]), "invalidVariantDescription");
    }
    expectRejected(withVariants([{ valueKeys: ["r", "g"], quantity: 1, isDefault: "yes" }]), "invalidVariantDefault");
    const { result } = parse(withVariants([{ valueKeys: ["r", "g"], quantity: 1, description: null }]));
    expect(result?.variants[0]).toMatchObject({ description: undefined, isDefault: false });
  });

  it("makes every variant resolve a price — its own, else the product's DEFAULT", () => {
    // No product default: a variant without its own price has none.
    expectRejected(
      withVariants(
        [
          { valueKeys: ["r", "g"], quantity: 1, rentPrice: 40 },
          { valueKeys: ["a", "g"], quantity: 1 },
        ],
        { rentPrice: undefined },
      ),
      "variantPriceRequired",
    );
    // Each with its own price → no default needed (Venta reads sellPrice the same way).
    const { reject } = parse(
      withVariants([{ valueKeys: ["r", "g"], quantity: 1, sellPrice: 15 }], {
        isRent: false,
        rentPrice: undefined,
        replacementPrice: undefined,
        securityDeposit: undefined,
      }),
    );
    expect(reject).not.toHaveBeenCalled();
    expectRejected(
      withVariants([{ valueKeys: ["r", "g"], quantity: 1 }], {
        isRent: false,
        rentPrice: undefined,
        sellPrice: undefined,
        replacementPrice: undefined,
        securityDeposit: undefined,
      }),
      "variantPriceRequired",
    );
    // The default covers a variant without its own.
    expect(parse(withVariants([{ valueKeys: ["r", "g"], quantity: 1 }])).reject).not.toHaveBeenCalled();
  });
});

describe("parseProductVariations — option kind and colour", () => {
  const colorOption = (values: unknown[], kind: unknown = "color") => ({ name: "Color", kind, values });

  it("defaults the kind to generic and lowercases a colour option's swatches", () => {
    const { result, reject } = parse(
      body({
        options: [
          colorOption([
            { key: "m", name: "Marfil", color: "#FFFFF0" },
            { key: "n", name: "Negro", color: "#000000" },
          ]),
          { name: "Forma", kind: null, values: [{ key: "o", name: "Redonda" }] },
        ],
        variants: [{ valueKeys: ["m", "o"], quantity: 2 }],
      }),
    );
    expect(reject).not.toHaveBeenCalled();
    expect(result?.options.map((option) => option.kind)).toEqual(["color", "generic"]);
    expect(result?.options[0]?.values.map((value) => value.color)).toEqual(["#fffff0", "#000000"]);
    expect(result?.options[1]?.values[0]?.color).toBeUndefined();
  });

  it("rejects an unknown kind and a second colour option", () => {
    expectRejected(body({ options: [colorOption([{ key: "m", name: "Marfil" }], "pattern")] }), "invalidOptionKind");
    expectRejected(
      body({
        options: [
          colorOption([{ key: "m", name: "Marfil", color: "#fffff0" }]),
          { name: "Tono", kind: "color", values: [{ key: "t", name: "Claro", color: "#eeeeee" }] },
        ],
      }),
      "multipleColorOptions",
    );
  });

  it("requires a valid #rrggbb on a colour value and forbids one on a generic value", () => {
    expectRejected(body({ options: [colorOption([{ key: "m", name: "Marfil" }])] }), "valueColorRequired");
    for (const color of ["fffff0", "#fff", "#gggggg", 7]) {
      expectRejected(body({ options: [colorOption([{ key: "m", name: "Marfil", color }])] }), "invalidValueColor");
    }
    expectRejected(
      body({ options: [{ name: "Forma", values: [{ key: "o", name: "Redonda", color: "#000000" }] }] }),
      "valueColorForbidden",
    );
  });
});

describe("parseProductVariations — stock mode", () => {
  it("rejects a non-boolean mode and shared stock without options", () => {
    expectRejected(withVariants([{ valueKeys: ["r", "g"], quantity: 1 }], { sharedStock: "yes" }), "invalidSharedStock");
    expectRejected(body({ sharedStock: true, quantity: 3 }), "sharedStockWithoutVariants");
  });

  it("shared: the product keeps its quantity, and a variant carries none (stored 0)", () => {
    const { result, reject } = parse(
      withVariants([{ valueKeys: ["r", "g"] }, { valueKeys: ["a", "g"], quantity: null }], {
        sharedStock: true,
        quantity: 4,
      }),
    );
    expect(reject).not.toHaveBeenCalled();
    expect(result?.sharedStock).toBe(true);
    expect(result?.variants.map((variant) => variant.quantity)).toEqual([0, 0]);
    expectRejected(
      withVariants([{ valueKeys: ["r", "g"], quantity: 2 }], { sharedStock: true }),
      "variantQuantityWithSharedStock",
    );
  });
});
