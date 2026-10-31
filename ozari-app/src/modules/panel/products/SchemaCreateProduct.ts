import {
  FULLNAME_REGEX,
  PRODUCT_DESCRIPTION_REGEX,
  PRODUCT_MAX_AMOUNT,
  PRODUCT_MAX_OPTION_VALUES,
  PRODUCT_MAX_OPTIONS,
  PRODUCT_MAX_QUANTITY,
  PRODUCT_MAX_VARIANTS,
  VARIATION_KEY_REGEX,
  VARIATION_NAME_REGEX,
} from '@constants/Regex';
import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { t } from 'i18next';
import { z } from 'zod';
import type { Product } from './product.types';
import {
  COLOR_HEX_REGEX,
  combinationOf,
  normalizeVariationName,
  valueKeyForId,
  variantRowIssues,
  type OptionFormRow,
  type VariantFormRow,
} from './productVariations';

const KEY = 'modules.panel.products.create.errors';

/** Business type ids — mirror the backend `BusinessTypeEnum` (seeded lookup, stable ids). */
export const BUSINESS_TYPE_RENT = 1;
export const BUSINESS_TYPE_SELL = 2;
/** Default rent period ("Día") and currency (GTQ) — the seeded defaults the form opens with. */
export const DEFAULT_RENT_TIME_UNIT_ID = 2;
export const DEFAULT_CURRENCY_ID = 1;

/**
 * Parses a MONEY text-input value: `''` = absent; otherwise it must be a plain non-negative number
 * within the global ceiling. Returns the parsed number, `undefined` when absent, or `null` when
 * present-but-invalid (the schema turns `null` into a field error).
 */
export const parseMoney = (value: string): number | undefined | null => {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > PRODUCT_MAX_AMOUNT) return null;
  return parsed;
};

/** Parses the QUANTITY text-input value: a required integer within `[0, PRODUCT_MAX_QUANTITY]`. */
export const parseQuantity = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > PRODUCT_MAX_QUANTITY) return null;
  return parsed;
};

/** A parsed money value truncated to cents (the API's own storage step); absent/invalid pass through
 *  as `undefined` — the field's own refinement already reports an invalid one. */
const toCents = (value: number | undefined | null): number | undefined =>
  value === undefined || value === null ? undefined : Math.trunc(value * 100) / 100;

const moneyField = (invalidMessage: string) =>
  z.string().refine((value) => parseMoney(value) !== null, invalidMessage);

/**
 * Mirrors the backend create-product validator (`ozari-api/.../products.validator.ts`): both sides
 * must accept and reject exactly the same values — the backend is the security boundary, this is
 * the UX mirror. Numeric TEXT inputs (prices, quantity) are kept as strings in the form and parsed
 * here + mapped to numbers on submit (`toCreateProductBody`); selects hold numeric ids directly.
 *
 * Split base/refine like the other schemas: `getZodRequiredPatterns` needs the plain `ZodObject`.
 */
const baseCreateProductSchema = z.object({
  name: z
    .string()
    .trim()
    .nonempty(t(`${KEY}.requiredName`))
    .refine((value) => FULLNAME_REGEX.test(value), t(`${KEY}.invalidName`)),
  description: z
    .string()
    .refine(
      (value) => value.trim() === '' || PRODUCT_DESCRIPTION_REGEX.test(value.trim()),
      t(`${KEY}.invalidDescription`),
    )
    .optional(),
  businessTypeId: z.number({ error: t(`${KEY}.requiredBusinessType`) }),
  categoryId: z.number({ error: t(`${KEY}.requiredCategory`) }),
  currencyId: z.number({ error: t(`${KEY}.requiredCurrency`) }),
  // REQUIRED without options or with a SHARED stock, FORBIDDEN otherwise (each variation owns its
  // stock — the API answers 400 `quantityWithVariants`), so the check lives in the rules below.
  quantity: z.string(),
  // With options: one stock on the product that every variation draws from (an arrangement with or
  // without its add-on) instead of one per variation (candles by colour). Ignored without options.
  sharedStock: z.boolean(),
  rentPrice: moneyField(t(`${KEY}.invalidRentPrice`)).optional(),
  // `null` = the empty-selection sentinel (see CustomSelectForm) — the conditional rule below
  // enforces presence for Alquiler; a bare `.optional()` would reject the sentinel outright.
  rentTimeUnitId: z.number().nullable().optional(),
  replacementPrice: moneyField(t(`${KEY}.invalidReplacementPrice`)).optional(),
  // Refundable deposit per unit ("Depósito") — never a price; Alquiler-only, ≤ replacement price.
  securityDeposit: moneyField(t(`${KEY}.invalidSecurityDeposit`)).optional(),
  sellPrice: moneyField(t(`${KEY}.invalidSellPrice`)).optional(),
  details: z.array(
    z.object({
      // Present on EDIT for a detail row the product already has (keep/update by id); absent on a
      // row the user just added. Never rendered — it rides the row through RHF into the body.
      id: z.number().optional(),
      detailTypeId: z.number({ error: t(`${KEY}.requiredDetailType`) }),
      detail: z
        .string()
        .trim()
        .nonempty(t(`${KEY}.requiredDetail`))
        .refine((value) => FULLNAME_REGEX.test(value), t(`${KEY}.invalidDetail`)),
    }),
  ),
  // VARIATIONS (2026-10-29). Array order = `sortOrder`. Names are checked in the cross-field rules
  // (uniqueness needs the siblings); `key` is minted by the editor, never typed. A `color` option's
  // values carry their `#rrggbb` (owner 2026-10-30).
  options: z.array(
    z.object({
      id: z.number().optional(),
      name: z.string(),
      kind: z.enum(['generic', 'color']),
      values: z.array(
        z.object({ id: z.number().optional(), key: z.string(), name: z.string(), color: z.string() }),
      ),
    }),
  ),
  // One row per OFFERED combination; money/quantity TEXT like the product's own fields, `''` on an
  // override = inherit.
  variants: z.array(
    z.object({
      id: z.number().optional(),
      valueKeys: z.array(z.string()),
      quantity: z.string(),
      rentPrice: z.string(),
      sellPrice: z.string(),
      replacementPrice: z.string(),
      securityDeposit: z.string(),
      description: z.string(),
      isDefault: z.boolean(),
    }),
  ),
});

/**
 * The VARIATION rules — the mirror of the API's `parseProductVariations`: at most
 * `PRODUCT_MAX_OPTIONS` options, each with 1..`PRODUCT_MAX_OPTION_VALUES` values; names 1–40 chars of
 * the full-name alphabet, unique case/accent-insensitively per product (options) and per option
 * (values); value keys well-formed and unique; with options, 1..`PRODUCT_MAX_VARIANTS` variations,
 * none without; each variation exactly one known key per option, a unique combination, its stock
 * and overrides valid for the business type (`variantRowIssues`, which also wants a price from the
 * row or the product); at most one default. At most ONE color option, and each of its values a real
 * colour. The product quantity is required without options, or when the stock is SHARED.
 */
function variationRules(data: z.infer<typeof baseCreateProductSchema>, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], leaf: string, params?: Record<string, unknown>): void =>
    ctx.addIssue({ code: 'custom', path, message: t(`${KEY}.${leaf}`, params) });
  const hasOptions = data.options.length > 0;
  const sharedStock = hasOptions && data.sharedStock;

  if ((!hasOptions || sharedStock) && parseQuantity(data.quantity) === null) {
    issue(['quantity'], 'invalidQuantity');
  }
  if (data.options.length > PRODUCT_MAX_OPTIONS) {
    issue(['options'], 'tooManyOptions', { max: PRODUCT_MAX_OPTIONS });
  }

  const optionNames = new Set<string>();
  const keys = new Set<string>();
  let colorOptions = 0;
  data.options.forEach((option, optionIndex) => {
    const name = option.name.trim();
    if (!VARIATION_NAME_REGEX.test(name)) issue(['options', optionIndex, 'name'], 'invalidOptionName');
    else if (optionNames.has(normalizeVariationName(name))) {
      issue(['options', optionIndex, 'name'], 'duplicateOptionName');
    } else optionNames.add(normalizeVariationName(name));
    const isColor = option.kind === 'color';
    if (isColor && ++colorOptions > 1) issue(['options', optionIndex, 'kind'], 'multipleColorOptions');

    if (option.values.length === 0) issue(['options', optionIndex, 'values'], 'requiredOptionValues');
    if (option.values.length > PRODUCT_MAX_OPTION_VALUES) {
      issue(['options', optionIndex, 'values'], 'tooManyOptionValues', { max: PRODUCT_MAX_OPTION_VALUES });
    }
    const valueNames = new Set<string>();
    option.values.forEach((value, valueIndex) => {
      const path = ['options', optionIndex, 'values', valueIndex, 'name'];
      const valueName = value.name.trim();
      if (!VARIATION_NAME_REGEX.test(valueName)) issue(path, 'invalidOptionValueName');
      else if (valueNames.has(normalizeVariationName(valueName))) issue(path, 'duplicateOptionValueName');
      else valueNames.add(normalizeVariationName(valueName));
      if (!VARIATION_KEY_REGEX.test(value.key) || keys.has(value.key)) {
        issue(['options', optionIndex, 'values', valueIndex, 'key'], 'invalidVariants');
      }
      keys.add(value.key);
      if (isColor && !COLOR_HEX_REGEX.test(value.color)) {
        issue(['options', optionIndex, 'values', valueIndex, 'color'], 'requiredValueColor');
      }
    });
  });

  if (!hasOptions) {
    if (data.variants.length > 0) issue(['variants'], 'invalidVariants');
    return;
  }
  if (data.variants.length === 0) issue(['variants'], 'requiredVariants');
  if (data.variants.length > PRODUCT_MAX_VARIANTS) {
    issue(['variants'], 'tooManyVariants', { max: PRODUCT_MAX_VARIANTS });
  }

  const optionOfKey = new Map<string, number>();
  data.options.forEach((option, optionIndex) =>
    option.values.forEach((value) => optionOfKey.set(value.key, optionIndex)),
  );
  const isRent = data.businessTypeId === BUSINESS_TYPE_RENT;
  const rowContext = {
    isRent,
    sharedStock,
    productPrice: (isRent ? data.rentPrice : data.sellPrice) ?? '',
    productReplacementPrice: data.replacementPrice ?? '',
    productSecurityDeposit: data.securityDeposit ?? '',
    parseMoney,
    parseQuantity,
    isValidDescription: (value: string) => PRODUCT_DESCRIPTION_REGEX.test(value),
  };
  const combinations = new Set<string>();
  let defaults = 0;
  data.variants.forEach((variant, index) => {
    // Exactly one KNOWN key per option, and a combination offered once. The editor builds rows only
    // from real combinations, so a failure here is a stale draft — reported on the row as a whole.
    const coveredOptions = new Set(variant.valueKeys.map((key) => optionOfKey.get(key)));
    const wellFormed =
      variant.valueKeys.length === data.options.length &&
      variant.valueKeys.every((key) => optionOfKey.has(key)) &&
      coveredOptions.size === data.options.length;
    const combination = combinationOf(variant.valueKeys);
    if (!wellFormed || combinations.has(combination)) {
      issue(['variants', index, 'valueKeys'], 'invalidVariants');
    }
    combinations.add(combination);
    if (variant.isDefault) defaults += 1;
    variantRowIssues(variant, rowContext).forEach(({ field, issue: leaf }) =>
      issue(['variants', index, field], leaf),
    );
  });
  if (defaults > 1) issue(['variants'], 'invalidVariants');
}

// The CONDITIONAL price rule (same as the backend): Alquiler → rentPrice + rent unit, no
// sellPrice; Venta → sellPrice only. The UI clears the irrelevant fields on a type switch, so a
// violation here means stale state — the message lands on the missing/forbidden field. Also the
// ONE-DETAIL-PER-TYPE rule (a table can't have two "Color"s — mirrored from the backend); the UI
// already filters used types out of each row's options, so a duplicate here means a stale draft.
export const createProductSchema = baseCreateProductSchema.superRefine((data, ctx) => {
  variationRules(data, ctx);
  const seenDetailTypes = new Set<number>();
  data.details.forEach((row, index) => {
    /* v8 ignore next -- defensive: Zod only runs refinements once the base schema (which already
       requires a numeric detailTypeId) passed, so a non-number can't reach here */
    if (typeof row.detailTypeId !== 'number') return;
    if (seenDetailTypes.has(row.detailTypeId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['details', index, 'detailTypeId'],
        message: t(`${KEY}.duplicateDetailType`),
      });
      return;
    }
    seenDetailTypes.add(row.detailTypeId);
  });
  const rent = parseMoney(data.rentPrice ?? '');
  const sell = parseMoney(data.sellPrice ?? '');
  // With options the general price is only the DEFAULT the variations inherit (owner 2026-10-30) —
  // each variation needs a price from somewhere, which `variantRowIssues` checks on its row.
  const priceRequired = data.options.length === 0;
  if (data.businessTypeId === BUSINESS_TYPE_RENT) {
    if (priceRequired && rent === undefined) {
      ctx.addIssue({ code: 'custom', path: ['rentPrice'], message: t(`${KEY}.requiredRentPrice`) });
    }
    if (data.rentTimeUnitId === undefined || data.rentTimeUnitId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['rentTimeUnitId'],
        message: t(`${KEY}.requiredRentTimeUnit`),
      });
    }
    if (sell !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['sellPrice'], message: t(`${KEY}.forbiddenSellPrice`) });
    }
    // The deposit covers PARTIAL damage; a total loss bills the replacement value — so a deposit
    // above it would make "broken" cheaper than "scratched" (mirrors the backend's
    // `securityDepositAboveReplacement`, compared on the cent-truncated values the API stores).
    const deposit = toCents(parseMoney(data.securityDeposit ?? ''));
    const replacement = toCents(parseMoney(data.replacementPrice ?? ''));
    if (deposit !== undefined && replacement !== undefined && deposit > replacement) {
      ctx.addIssue({
        code: 'custom',
        path: ['securityDeposit'],
        message: t(`${KEY}.securityDepositAboveReplacement`),
      });
    }
  } else if (data.businessTypeId === BUSINESS_TYPE_SELL) {
    if (priceRequired && sell === undefined) {
      ctx.addIssue({ code: 'custom', path: ['sellPrice'], message: t(`${KEY}.requiredSellPrice`) });
    }
    if (rent !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['rentPrice'], message: t(`${KEY}.forbiddenRentPrice`) });
    }
    // Replacement price is billed for a lost/damaged RENTAL — a sold item is consumed, nothing to
    // replace. The UI hides + clears the field for Venta; this catches a stale draft (mirrors the
    // backend's `replacementPriceForbidden`).
    if (parseMoney(data.replacementPrice ?? '') !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['replacementPrice'],
        message: t(`${KEY}.forbiddenReplacementPrice`),
      });
    }
    // Same for the deposit: nothing comes back from a sale, so there is no guarantee to hold
    // (mirrors `securityDepositForbidden`).
    if (parseMoney(data.securityDeposit ?? '') !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['securityDeposit'],
        message: t(`${KEY}.forbiddenSecurityDeposit`),
      });
    }
  }
});

export type CreateProductFormType = z.infer<typeof createProductSchema>;

export const createProductDefaultValues: CreateProductFormType = {
  name: '',
  description: '',
  businessTypeId: BUSINESS_TYPE_RENT,
  categoryId: null as unknown as number, // null = the category select opens on its placeholder
  currencyId: DEFAULT_CURRENCY_ID,
  quantity: '',
  sharedStock: false,
  rentPrice: '',
  rentTimeUnitId: DEFAULT_RENT_TIME_UNIT_ID,
  replacementPrice: '',
  securityDeposit: '',
  sellPrice: '',
  details: [],
  options: [],
  variants: [],
};

/** A gallery reference for the create body: an R2 key from the presign flow + the primary flag. */
export interface CreateProductImageRef {
  key: string;
  isPrimary: boolean;
}

/** One option of the body (array order = `sortOrder`). `id` only on an UPDATE of a saved option. */
export interface ProductOptionBody {
  id?: number;
  name: string;
  /** Sent only for the special kind (absent = `generic`). */
  kind?: 'color';
  values: {
    id?: number;
    /** The client key variations reference this value by (unique in the body). */
    key: string;
    name: string;
    /** `#rrggbb` — on a COLOR option's values only. */
    color?: string;
    /** The value's OWN photo set — kept by `id`, new by uploaded `key`; one primary at most. */
    images: UpdateProductImageRef[];
  }[];
}

/** One offered combination of the body. Overrides only when typed (absent = inherit), following
 *  the business type; `isDefault` only on the default. `quantity` is absent with a SHARED stock. */
export interface ProductVariantBody {
  id?: number;
  valueKeys: string[];
  quantity?: number;
  rentPrice?: number;
  sellPrice?: number;
  replacementPrice?: number;
  securityDeposit?: number;
  description?: string;
  isDefault?: true;
}

/** The `POST /products` body — numbers where the API wants numbers, absent fields omitted. */
export interface CreateProductBody {
  name: string;
  description?: string;
  businessTypeId: number;
  categoryId: number;
  currencyId: number;
  /** The product's stock — present without options, or with a SHARED stock (else each variation
   *  owns its stock). */
  quantity?: number;
  /** Sent only when true (with options): every variation draws from `quantity`. */
  sharedStock?: true;
  rentPrice?: number;
  rentTimeUnitId?: number;
  replacementPrice?: number;
  /** Refundable deposit per unit (Alquiler only) — omitted = none. */
  securityDeposit?: number;
  sellPrice?: number;
  productDetails: { detailTypeId: number; detail: string }[];
  /** Uploaded SHOWCASE photos (array order = display order). Omitted when there are none. */
  images?: CreateProductImageRef[];
  /** Options + variations — both omitted for a product without variations ("absent = none"). */
  options?: ProductOptionBody[];
  variants?: ProductVariantBody[];
}

/** Each value's final photo set, by value KEY (assembled by the form after the uploads). */
export type ValueImagesByKey = Record<string, UpdateProductImageRef[]>;

/**
 * The body's options + variations from the form (`withIds`: an UPDATE keeps the saved ids — a
 * create never sends one). Overrides travel only when typed and only for the business type
 * (Alquiler → rent/replacement/deposit, Venta → sell); a deposit of `0` is sent (explicitly none).
 */
function variationsBody(
  data: CreateProductFormType,
  imagesByValueKey: ValueImagesByKey,
  withIds: boolean,
): Pick<CreateProductBody, 'options' | 'variants'> {
  if (data.options.length === 0) return {};
  const money = (value: string): number | undefined => toCents(parseMoney(value));
  const id = (row: { id?: number }) => (withIds && row.id !== undefined ? { id: row.id } : {});
  const isRent = data.businessTypeId === BUSINESS_TYPE_RENT;
  return {
    options: data.options.map((option) => ({
      ...id(option),
      name: option.name.trim(),
      ...(option.kind === 'color' && { kind: 'color' as const }),
      values: option.values.map((value) => ({
        ...id(value),
        key: value.key,
        name: value.name.trim(),
        // A generic option keeps its values' colours in the FORM (a round trip back to Color loses
        // nothing) but never sends them — the API refuses a colour there.
        ...(option.kind === 'color' && { color: value.color.toLowerCase() }),
        images: (imagesByValueKey[value.key] ?? []).map((image) =>
          withIds ? image : { key: image.key as string, isPrimary: image.isPrimary },
        ),
      })),
    })),
    variants: data.variants.map((variant) => {
      const overrides = isRent
        ? {
            rentPrice: money(variant.rentPrice),
            replacementPrice: money(variant.replacementPrice),
            securityDeposit: money(variant.securityDeposit),
          }
        : { sellPrice: money(variant.sellPrice) };
      const description = variant.description.trim();
      return {
        ...id(variant),
        valueKeys: variant.valueKeys,
        // A shared stock lives on the product: the rows keep what was typed (switching back to one
        // stock per variation restores it) but send none.
        ...(!data.sharedStock && {
          /* v8 ignore next -- parseQuantity is guaranteed non-null by the schema */
          quantity: parseQuantity(variant.quantity) ?? 0,
        }),
        ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)),
        ...(description && { description }),
        ...(variant.isDefault && { isDefault: true as const }),
      };
    }),
  };
}

/** Maps the validated form values to the API body (money truncated to 2 decimals, like the backend). */
export function toCreateProductBody(
  data: CreateProductFormType,
  imagesByValueKey: ValueImagesByKey = {},
): CreateProductBody {
  const money = (value: string | undefined): number | undefined => toCents(parseMoney(value ?? ''));
  const isRent = data.businessTypeId === BUSINESS_TYPE_RENT;
  const description = data.description?.trim();
  return {
    name: data.name.trim(),
    ...(description && { description }),
    businessTypeId: data.businessTypeId,
    categoryId: data.categoryId,
    currencyId: data.currencyId,
    // With options the stock is per variation — the API refuses a product quantity then — unless it
    // is SHARED, where the product's one quantity is the pool every variation draws from.
    ...((data.options.length === 0 || data.sharedStock) && {
      quantity: parseQuantity(data.quantity) ?? 0,
    }),
    ...(data.options.length > 0 && data.sharedStock && { sharedStock: true as const }),
    ...variationsBody(data, imagesByValueKey, false),
    // A blank general price on a product with options is simply absent (the variations carry
    // theirs); `money` already answers `undefined` for blank, and JSON drops the key.
    ...(isRent && { rentPrice: money(data.rentPrice), rentTimeUnitId: data.rentTimeUnitId ?? undefined }),
    ...(!isRent && { sellPrice: money(data.sellPrice) }),
    // Alquiler only — a Venta body never carries the key (the backend forbids it there).
    ...(isRent &&
      money(data.replacementPrice) !== undefined && {
        replacementPrice: money(data.replacementPrice),
      }),
    // Alquiler only, like the replacement price. An absent key on an UPDATE clears the column
    // (the body is the product's full state), so the edit form must load and resend it.
    ...(isRent &&
      money(data.securityDeposit) !== undefined && {
        securityDeposit: money(data.securityDeposit),
      }),
    productDetails: data.details.map((row) => ({
      detailTypeId: row.detailTypeId,
      detail: row.detail.trim(),
    })),
  };
}

// A variation's overrides are blank-means-inherit (never required) — they show the inherited value
// as their placeholder instead of an asterisk.
const VARIANT_OVERRIDE_PATTERN = /variants.*(rentPrice|sellPrice|replacementPrice|securityDeposit|description|isDefault)/;
export const createProductRequiredPatterns = getZodRequiredPatterns(baseCreateProductSchema).filter(
  (pattern) => !VARIANT_OVERRIDE_PATTERN.test(pattern.source),
);

/**
 * One slot of the FINAL gallery for `PUT /products/:id` (the RECONCILE design): a kept photo by its
 * DB row `id`, or a new photo by its uploaded R2 `key`. Array order = display order (`sortOrder`).
 */
export interface UpdateProductImageRef {
  id?: number;
  key?: string;
  isPrimary: boolean;
}

/** The `PUT /products/:id` body — the product's FULL desired state, never a partial patch. */
export interface UpdateProductBody extends Omit<CreateProductBody, 'images' | 'productDetails'> {
  /** Kept rows carry their `id` (update in place); id-less rows create; absent rows delete. */
  productDetails: { id?: number; detailTypeId: number; detail: string }[];
  images: UpdateProductImageRef[];
}

/** Maps the validated form values to the update body — the create mapping, keeping detail row ids
 *  and the saved option / value / variation ids (a removed one is simply absent). */
export function toUpdateProductBody(
  data: CreateProductFormType,
  imagesByValueKey: ValueImagesByKey = {},
): UpdateProductBody {
  const createBody = toCreateProductBody(data);
  return {
    ...createBody,
    ...variationsBody(data, imagesByValueKey, true),
    productDetails: data.details.map((row) => ({
      ...(row.id !== undefined && { id: row.id }),
      detailTypeId: row.detailTypeId,
      detail: row.detail.trim(),
    })),
    images: [],
  };
}

/**
 * The edit form's initial values, from the role-projected product (Admin view — the edit page is
 * admin-gated). Money/quantity map back to the TEXT inputs; the recorded fleet quantity is `total`
 * for Alquiler (units come back) and `available` for Venta (sales already decremented it) —
 * exactly how the projection encodes it.
 */
export function productToFormValues(product: {
  name: string;
  description?: string;
  businessTypeId: number;
  categoryId: number;
  currency: { id: number };
  rentPrice?: number;
  sellPrice?: number;
  rentTimeUnitId?: number;
  replacementPrice?: number;
  securityDeposit?: number;
  total?: number;
  available?: number;
  details: { id: number; detailTypeId: number; detail: string }[];
  options?: Product['options'];
  variants?: Product['variants'];
  sharedStock?: boolean;
}): CreateProductFormType {
  const money = (value: number | undefined): string => (value === undefined ? '' : String(value));
  // Saved values travel under `v<id>` for the whole edit, so their variations keep pointing at them
  // through renames and reorders.
  const options: OptionFormRow[] = [...(product.options ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((option) => ({
      id: option.id,
      name: option.name,
      kind: option.kind,
      values: [...option.values]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((value) => ({
          id: value.id,
          key: valueKeyForId(value.id),
          name: value.name,
          color: value.color ?? '',
        })),
    }));
  // The RAW override columns (`overrides`), never the effective values: an inherited price must
  // stay inherited, or the first save would freeze today's product price onto every variation. The
  // stock is the variation's own `quantity`.
  const variants: VariantFormRow[] = options.length === 0
    ? []
    : (product.variants ?? []).map((variant) => ({
        id: variant.id,
        valueKeys: variant.valueIds.map(valueKeyForId),
        quantity: String(variant.quantity ?? variant.total ?? variant.available ?? 0),
        rentPrice: money(variant.overrides?.rentPrice),
        sellPrice: money(variant.overrides?.sellPrice),
        replacementPrice: money(variant.overrides?.replacementPrice),
        securityDeposit: money(variant.overrides?.securityDeposit),
        description: variant.overrides?.description ?? '',
        isDefault: variant.isDefault,
      }));
  return {
    name: product.name,
    description: product.description ?? '',
    businessTypeId: product.businessTypeId,
    categoryId: product.categoryId,
    currencyId: product.currency.id,
    // With a SHARED stock the product-level figures ARE the pool, so this reads it back the same way.
    quantity: String(product.total ?? product.available ?? 0),
    sharedStock: options.length > 0 && product.sharedStock === true,
    rentPrice: money(product.rentPrice),
    rentTimeUnitId: product.rentTimeUnitId ?? null,
    replacementPrice: money(product.replacementPrice),
    securityDeposit: money(product.securityDeposit),
    sellPrice: money(product.sellPrice),
    details: product.details.map((detail) => ({
      id: detail.id,
      detailTypeId: detail.detailTypeId,
      detail: detail.detail,
    })),
    options,
    variants,
  };
}
