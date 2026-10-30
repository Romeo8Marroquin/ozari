import { appConfig } from "@/config/app.js";
import {
  descriptionTextRegex,
  variationNameRegex,
  variationValueKeyRegex,
} from "@helpers/regex.js";
import type {
  ProductOptionRequestModel,
  ProductOptionValueRequestModel,
  ProductVariantRequestModel,
  ProductVariationImageRequestModel,
} from "./products.models.js";

/**
 * PRODUCT VARIATIONS — the ONE parser of a product body's `options` + `variants` (owner 2026-10-29,
 * EPIC-1-INVENTORY §6). Called by BOTH `validateCreateProduct` and `validateUpdateProduct`, so the
 * two doors can never accept different matrices. Pure: no DB access — the update validator loads
 * the product's current ids and hands them in as `existing` (`null` = create, where every `id` is
 * forbidden). Rejects with its own keys (`products.variations.validators.*`).
 *
 * Also home to the small product rules both validators share (image-key shape, optional money, the
 * deposit ceiling), so the variant overrides reuse exactly the product-level checks.
 */

/**
 * Matches an R2 object key OUR upload-url endpoint mints for product images:
 * `products/<uuid v4>.<whitelisted extension>`. Built from the same config the mint uses, so a
 * create/update only ever persists keys that could have come from our own presign flow — an
 * arbitrary client-invented key (path traversal, another prefix, another bucket's layout) is a 400.
 */
export const buildProductImageKeyRegex = (): RegExp => {
  const prefix = appConfig.storage.keyPrefixes.product;
  const extensions = Object.values(appConfig.storage.allowedImageTypes).join("|");
  // eslint-disable-next-line security/detect-non-literal-regexp -- built ONLY from static appConfig constants (never user input)
  return new RegExp(
    `^${prefix}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:${extensions})$`,
  );
};

/**
 * Sanitizes an OPTIONAL money field: absent (`undefined`/`null`) stays absent; a present value must
 * be a number within `[0, maxGlobalAmount]` and is truncated to 2 decimals (never rounded up — we
 * don't invent cents). `ok: false` = present but invalid (the caller sends its own 400).
 */
export const sanitizeOptionalMoney = (
  value: unknown,
): { ok: true; value: number | undefined } | { ok: false } => {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    value < 0 ||
    value > appConfig.maxGlobalAmount
  ) {
    return { ok: false };
  }
  return { ok: true, value: Math.trunc(value * 100) / 100 };
};

/**
 * The security-deposit rule (owner 2026-10-27): ALQUILER-only (a sold item leaves for good — there
 * is nothing to give back a guarantee on), and never above the replacement price when both are set —
 * it covers partial damage, and a total loss is billed at the replacement value, so a bigger deposit
 * would make "broken" cheaper than "scratched". Returns the rejection key, or `undefined`.
 */
export const securityDepositViolation = (
  isRent: boolean,
  securityDeposit: number | undefined,
  replacementPrice: number | undefined,
): string | undefined => {
  if (securityDeposit === undefined) {
    return undefined;
  }
  if (!isRent) {
    return "securityDepositForbidden";
  }
  return replacementPrice !== undefined && securityDeposit > replacementPrice
    ? "securityDepositAboveReplacement"
    : undefined;
};

/** Case-, accent- and spacing-insensitive form of a name — what "the same option/value" means. */
export const normalizeVariationName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** The body fields the parser reads (the scalars are ALREADY sanitized by the validator). */
export interface ProductVariationsBody {
  options: unknown;
  variants: unknown;
  /** The raw `quantity` — forbidden when options exist (the stock then lives on each variant). */
  quantity: unknown;
  isRent: boolean;
  /** The product's sanitized values — the inherited side of every EFFECTIVE check. */
  replacementPrice: number | undefined;
  securityDeposit: number | undefined;
  /** The sanitized SHOWCASE gallery — image keys/ids are unique across EVERY set of the body, and
   *  the total cap counts it. */
  showcaseImages: ReadonlyArray<{ id?: number; key?: string }>;
}

/** What the update validator knows about the product today (`null` on create). */
export interface ExistingProductVariations {
  /** Every photo of the product, any set — a kept photo may move between sets. */
  imageIds: readonly number[];
  options: ReadonlyArray<{ id: number; values: ReadonlyArray<{ id: number }> }>;
  /** Only ACTIVE variants can be kept; a tombstone is never revived (re-adding = a new row). */
  activeVariantIds: readonly number[];
}

export type RejectVariation = (key: string, logParams: Record<string, unknown>) => void;

export interface ParsedProductVariations {
  options: ProductOptionRequestModel[];
  variants: ProductVariantRequestModel[];
}

/** Mutable state threaded through one parse. */
interface ParseContext {
  isCreate: boolean;
  reject: RejectVariation;
  imageKeyRegex: RegExp;
  existingImageIds: ReadonlySet<number>;
  existingOptionIds: ReadonlySet<number>;
  /** valueId → the optionId it belongs to today. */
  valueOwner: ReadonlyMap<number, number>;
  activeVariantIds: ReadonlySet<number>;
  seenImageKeys: Set<string>;
  seenImageIds: Set<number>;
  seenValueKeys: Set<string>;
  seenValueIds: Set<number>;
  totalImages: number;
}

const isPresent = (value: unknown): boolean => value !== undefined && value !== null;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/** A trimmed option/value name, or `null` when it fails `variationNameRegex`. */
const sanitizeVariationName = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return variationNameRegex.test(trimmed) ? trimmed : null;
};

/**
 * Parses the body's variations. Returns `null` once it has rejected (the caller just returns).
 * Order of the checks is part of the contract only in that each failure has its own key.
 */
export function parseProductVariations(
  body: ProductVariationsBody,
  existing: ExistingProductVariations | null,
  reject: RejectVariation,
): ParsedProductVariations | null {
  const rawOptions = body.options ?? [];
  if (!Array.isArray(rawOptions)) {
    reject("invalidOptions", { options: body.options });
    return null;
  }
  if (rawOptions.length > appConfig.maxProductOptions) {
    reject("tooManyOptions", { count: rawOptions.length, max: appConfig.maxProductOptions });
    return null;
  }
  if (rawOptions.length > 0 && isPresent(body.quantity)) {
    reject("quantityWithVariants", { quantity: body.quantity });
    return null;
  }

  const context = buildParseContext(body, existing, reject);
  const options = parseOptions(rawOptions, context);
  if (!options) {
    return null;
  }
  const variants = parseVariants(body, options, context);
  if (!variants) {
    return null;
  }
  return { options, variants };
}

/** The parse's starting state: what the product has today, and what the showcase already uses. */
function buildParseContext(
  body: ProductVariationsBody,
  existing: ExistingProductVariations | null,
  reject: RejectVariation,
): ParseContext {
  const currentOptions = existing?.options ?? [];
  return {
    isCreate: existing === null,
    reject,
    imageKeyRegex: buildProductImageKeyRegex(),
    existingImageIds: new Set(existing?.imageIds ?? []),
    existingOptionIds: new Set(currentOptions.map((option) => option.id)),
    valueOwner: new Map(
      currentOptions.flatMap((option) => option.values.map((value) => [value.id, option.id])),
    ),
    activeVariantIds: new Set(existing?.activeVariantIds ?? []),
    seenImageKeys: new Set(body.showcaseImages.flatMap((image) => image.key ?? [])),
    seenImageIds: new Set(body.showcaseImages.flatMap((image) => image.id ?? [])),
    seenValueKeys: new Set(),
    seenValueIds: new Set(),
    totalImages: body.showcaseImages.length,
  };
}

/** An `id` slot: absent is fine; present is forbidden on create, else must pass `isValid`. */
function checkId(
  id: unknown,
  context: ParseContext,
  rejectKey: string,
  isValid: (id: number) => boolean,
): { ok: true; id: number | undefined } | { ok: false } {
  if (!isPresent(id)) {
    return { ok: true, id: undefined };
  }
  if (context.isCreate) {
    context.reject("idsForbiddenOnCreate", { id });
    return { ok: false };
  }
  if (typeof id !== "number" || !isValid(id)) {
    context.reject(rejectKey, { id });
    return { ok: false };
  }
  return { ok: true, id };
}

function parseOptions(
  rawOptions: unknown[],
  context: ParseContext,
): ProductOptionRequestModel[] | null {
  const options: ProductOptionRequestModel[] = [];
  const seenNames = new Set<string>();
  const seenIds = new Set<number>();
  for (const raw of rawOptions) {
    const option = asRecord(raw);
    const id = checkId(
      option["id"],
      context,
      "invalidOptionId",
      (value) => context.existingOptionIds.has(value) && !seenIds.has(value),
    );
    if (!id.ok) {
      return null;
    }
    if (id.id !== undefined) {
      seenIds.add(id.id);
    }
    const name = sanitizeVariationName(option["name"]);
    if (name === null) {
      context.reject("invalidOptionName", { name: option["name"] });
      return null;
    }
    const normalized = normalizeVariationName(name);
    if (seenNames.has(normalized)) {
      context.reject("duplicateOptionName", { name });
      return null;
    }
    seenNames.add(normalized);

    const values = parseValues(option["values"], id.id, context);
    if (!values) {
      return null;
    }
    options.push({ ...(id.id !== undefined && { id: id.id }), name, values });
  }
  return options;
}

function parseValues(
  rawValues: unknown,
  optionId: number | undefined,
  context: ParseContext,
): ProductOptionValueRequestModel[] | null {
  if (!Array.isArray(rawValues) || rawValues.length === 0) {
    context.reject("invalidOptionValues", { values: rawValues });
    return null;
  }
  if (rawValues.length > appConfig.maxOptionValues) {
    context.reject("tooManyOptionValues", {
      count: rawValues.length,
      max: appConfig.maxOptionValues,
    });
    return null;
  }
  const values: ProductOptionValueRequestModel[] = [];
  const seenNames = new Set<string>();
  for (const raw of rawValues as unknown[]) {
    const value = parseValue(asRecord(raw), optionId, context, seenNames);
    if (!value) {
      return null;
    }
    values.push(value);
  }
  return values;
}

/** One value: its id (kept under the SAME option), key, name (unique in the option) and photos. */
function parseValue(
  value: Record<string, unknown>,
  optionId: number | undefined,
  context: ParseContext,
  seenNames: Set<string>,
): ProductOptionValueRequestModel | null {
  const id = checkId(
    value["id"],
    context,
    "invalidValueId",
    (candidate) => context.valueOwner.has(candidate) && !context.seenValueIds.has(candidate),
  );
  if (!id.ok) {
    return null;
  }
  if (id.id !== undefined) {
    // A value stays under its option: kept under a different (or a brand-new) one is a MOVE.
    if (context.valueOwner.get(id.id) !== optionId) {
      context.reject("valueMovedOption", { valueId: id.id, optionId });
      return null;
    }
    context.seenValueIds.add(id.id);
  }
  const key = value["key"];
  if (typeof key !== "string" || !variationValueKeyRegex.test(key)) {
    context.reject("invalidValueKey", { key });
    return null;
  }
  if (context.seenValueKeys.has(key)) {
    context.reject("duplicateValueKey", { key });
    return null;
  }
  context.seenValueKeys.add(key);
  const name = sanitizeVariationName(value["name"]);
  if (name === null) {
    context.reject("invalidValueName", { name: value["name"] });
    return null;
  }
  const normalized = normalizeVariationName(name);
  if (seenNames.has(normalized)) {
    context.reject("duplicateValueName", { name });
    return null;
  }
  seenNames.add(normalized);

  const images = parseImageSet(value["images"], context);
  if (!images) {
    return null;
  }
  return { ...(id.id !== undefined && { id: id.id }), key, name, images };
}

/** One value's photo set — the showcase gallery's rules, its own cap, and the body-wide total. */
function parseImageSet(
  rawImages: unknown,
  context: ParseContext,
): ProductVariationImageRequestModel[] | null {
  const list = rawImages ?? [];
  if (!Array.isArray(list)) {
    context.reject("invalidValueImages", { images: rawImages });
    return null;
  }
  if (list.length > appConfig.storage.maxImagesPerOptionValue) {
    context.reject("tooManyValueImages", {
      count: list.length,
      max: appConfig.storage.maxImagesPerOptionValue,
    });
    return null;
  }
  let primaryCount = 0;
  const images: ProductVariationImageRequestModel[] = [];
  for (const raw of list as unknown[]) {
    const slot = parseImageSlot(raw, context);
    if (!slot) {
      return null;
    }
    images.push(slot);
    primaryCount += Number(asRecord(raw)["isPrimary"] === true);
  }
  if (primaryCount > 1) {
    context.reject("multiplePrimaryImages", { primaryCount });
    return null;
  }
  context.totalImages += images.length;
  if (context.totalImages > appConfig.storage.maxImagesTotalPerProduct) {
    context.reject("tooManyImagesTotal", {
      count: context.totalImages,
      max: appConfig.storage.maxImagesTotalPerProduct,
    });
    return null;
  }
  // Same default as the showcase: no flagged primary ⇒ the FIRST photo of the set is the primary.
  return images.map((image, index) => ({
    ...image,
    isPrimary: primaryCount === 0 ? index === 0 : asRecord(list[index])["isPrimary"] === true,
  }));
}

/** One photo slot: exactly one of a kept `id` (this product's, any set) or a minted `key`. */
function parseImageSlot(
  raw: unknown,
  context: ParseContext,
): ProductVariationImageRequestModel | null {
  const image = asRecord(raw);
  const hasId = isPresent(image["id"]);
  if (hasId === isPresent(image["key"])) {
    context.reject("invalidImageEntry", { image: raw });
    return null;
  }
  if (hasId) {
    const id = checkId(
      image["id"],
      context,
      "invalidImageId",
      (candidate) => context.existingImageIds.has(candidate) && !context.seenImageIds.has(candidate),
    );
    if (!id.ok) {
      return null;
    }
    context.seenImageIds.add(id.id as number);
    return { id: id.id as number };
  }
  const key = image["key"];
  if (typeof key !== "string" || !context.imageKeyRegex.test(key)) {
    context.reject("invalidImageKey", { key });
    return null;
  }
  if (context.seenImageKeys.has(key)) {
    context.reject("duplicateImageKey", { key });
    return null;
  }
  context.seenImageKeys.add(key);
  return { key };
}

function parseVariants(
  body: ProductVariationsBody,
  options: readonly ProductOptionRequestModel[],
  context: ParseContext,
): ProductVariantRequestModel[] | null {
  const list = body.variants ?? [];
  if (!Array.isArray(list)) {
    context.reject("invalidVariants", { variants: body.variants });
    return null;
  }
  if (options.length === 0) {
    if (list.length > 0) {
      context.reject("variantsWithoutOptions", { count: list.length });
      return null;
    }
    return [];
  }
  if (list.length === 0) {
    context.reject("variantsRequired", {});
    return null;
  }
  if (list.length > appConfig.maxProductVariants) {
    context.reject("tooManyVariants", { count: list.length, max: appConfig.maxProductVariants });
    return null;
  }

  const structure: VariantStructure = {
    optionCount: options.length,
    optionOfKey: new Map(
      options.flatMap((option, index) => option.values.map((value) => [value.key, index])),
    ),
    seenIds: new Set<number>(),
  };
  const variants: ProductVariantRequestModel[] = [];
  const seenCombinations = new Set<string>();
  let defaultCount = 0;
  for (const raw of list as unknown[]) {
    const variant = parseVariant(asRecord(raw), structure, body, context);
    if (!variant) {
      return null;
    }
    const combination = variant.valueKeys.join("|");
    if (seenCombinations.has(combination)) {
      context.reject("duplicateVariantCombination", { valueKeys: variant.valueKeys });
      return null;
    }
    seenCombinations.add(combination);
    defaultCount += Number(variant.isDefault);
    variants.push(variant);
  }
  if (defaultCount > 1) {
    context.reject("multipleDefaultVariants", { defaultCount });
    return null;
  }
  return variants;
}

/** Exactly one known value key per option, returned in OPTION order (the canonical combination). */
function canonicalValueKeys(
  rawKeys: unknown,
  optionCount: number,
  optionOfKey: ReadonlyMap<string, number>,
): string[] | null {
  if (!Array.isArray(rawKeys) || rawKeys.length !== optionCount) {
    return null;
  }
  const byOption: (string | undefined)[] = Array.from({ length: optionCount }, () => undefined);
  for (const key of rawKeys as unknown[]) {
    const optionIndex = typeof key === "string" ? optionOfKey.get(key) : undefined;
    if (optionIndex === undefined || byOption[optionIndex] !== undefined) {
      return null;
    }
    byOption[optionIndex] = key as string;
  }
  // Length matches and no option was filled twice ⇒ every slot is filled.
  return byOption as string[];
}

/** What every variant of one body is checked against. */
interface VariantStructure {
  optionCount: number;
  /** value key → its option's index. */
  optionOfKey: ReadonlyMap<string, number>;
  /** Variant ids already kept by an earlier entry. */
  seenIds: Set<number>;
}

// eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- one linear pass over a variant's fields, each check rejecting with its own key
function parseVariant(
  variant: Record<string, unknown>,
  structure: VariantStructure,
  body: ProductVariationsBody,
  context: ParseContext,
): ProductVariantRequestModel | null {
  const { optionCount, optionOfKey, seenIds } = structure;
  const id = checkId(
    variant["id"],
    context,
    "invalidVariantId",
    (candidate) => context.activeVariantIds.has(candidate) && !seenIds.has(candidate),
  );
  if (!id.ok) {
    return null;
  }
  if (id.id !== undefined) {
    seenIds.add(id.id);
  }
  const valueKeys = canonicalValueKeys(variant["valueKeys"], optionCount, optionOfKey);
  if (!valueKeys) {
    context.reject("invalidVariantValues", { valueKeys: variant["valueKeys"] });
    return null;
  }
  const quantity = variant["quantity"];
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 0 ||
    quantity > appConfig.maxGlobalQuantity
  ) {
    context.reject("invalidVariantQuantity", { quantity });
    return null;
  }

  const money: Record<"rentPrice" | "sellPrice" | "replacementPrice" | "securityDeposit", number | undefined> = {
    rentPrice: undefined,
    sellPrice: undefined,
    replacementPrice: undefined,
    securityDeposit: undefined,
  };
  for (const field of ["rentPrice", "sellPrice", "replacementPrice", "securityDeposit"] as const) {
    const sanitized = sanitizeOptionalMoney(variant[field]);
    if (!sanitized.ok) {
      context.reject("invalidVariantPrice", { field, value: variant[field] });
      return null;
    }
    money[field] = sanitized.value;
  }
  // The overrides follow the product's business type, exactly like the product's own prices.
  const mismatched = body.isRent
    ? money.sellPrice !== undefined
    : money.rentPrice !== undefined ||
      money.replacementPrice !== undefined ||
      money.securityDeposit !== undefined;
  if (mismatched) {
    context.reject("variantPricingMismatch", { isRent: body.isRent, ...money });
    return null;
  }
  // The deposit ceiling on EFFECTIVE values (the override, else the product's).
  const effectiveDeposit = money.securityDeposit ?? body.securityDeposit;
  const effectiveReplacement = money.replacementPrice ?? body.replacementPrice;
  if (securityDepositViolation(body.isRent, effectiveDeposit, effectiveReplacement) !== undefined) {
    context.reject("variantSecurityDepositAboveReplacement", {
      securityDeposit: effectiveDeposit,
      replacementPrice: effectiveReplacement,
    });
    return null;
  }

  const rawDescription = variant["description"];
  let description: string | undefined;
  if (isPresent(rawDescription) && rawDescription !== "") {
    const trimmed = typeof rawDescription === "string" ? rawDescription.trim() : "";
    if (!descriptionTextRegex.test(trimmed)) {
      context.reject("invalidVariantDescription", { description: rawDescription });
      return null;
    }
    description = trimmed;
  }
  const isDefault = variant["isDefault"];
  if (isPresent(isDefault) && typeof isDefault !== "boolean") {
    context.reject("invalidVariantDefault", { isDefault });
    return null;
  }

  return {
    ...(id.id !== undefined && { id: id.id }),
    valueKeys,
    quantity,
    ...money,
    description,
    isDefault: isDefault === true,
  };
}
