import { PRODUCT_MAX_VARIANTS } from '@constants/Regex';
import type { Product, ProductImage, ProductVariant } from './product.types';

/**
 * PRODUCT VARIATIONS — the pure half (owner, 2026-10-29). A product may declare up to three OPTIONS
 * ("Color", "Tamaño"), each with values ("Rojo", "Redondo"); every OFFERED combination is a
 * VARIATION with its own stock that may override the price, deposit, replacement or description.
 *
 * Everything here is a decision with no React in it, so the form, the order form, the documents and
 * the detail page can share it and it can be tested exhaustively:
 *
 * - **Names.** A variation is named by its values only, joined by {@link VARIANT_LABEL_SEPARATOR}
 *   ("Rojo · Redondo"); a LINE that rents/sells one is named by {@link lineDisplayName}
 *   ("Mantel — Rojo · Redondo"). ONE separator each, used everywhere a name prints.
 * - **The form's structure.** Values are referenced by a client-minted KEY (`v<id>` for a saved
 *   value, `n<k>` for a new one) — the body's `valueKeys` contract. A variation's keys are a SET
 *   (one per option); its order on screen always follows the options', so reordering options never
 *   rewrites a variation.
 * - **The order side.** Which variation a line holds, its EFFECTIVE prices (the API already sends
 *   them effective — never re-derived here), and how per-option picks resolve to a variation.
 */

/** Between a product's name and its variation's: "Mantel — Rojo · Redondo". */
export const LINE_NAME_SEPARATOR = ' — ';
/** Between a variation's option values: "Rojo · Redondo" (the API builds `label` the same way). */
export const VARIANT_LABEL_SEPARATOR = ' · ';

/** The name a LINE prints everywhere (documents, detail, settlement, deposit card, status dialog). A
 *  line without a variation keeps the bare product name — exactly what it printed before. */
export function lineDisplayName(line: { productName: string; variantLabel?: string | null }): string {
  const label = line.variantLabel?.trim();
  return label ? `${line.productName}${LINE_NAME_SEPARATOR}${label}` : line.productName;
}

/** The comparison form of an option/value name — trimmed, inner spaces collapsed, lower-cased and
 *  accent-free, so "Rojo", " rojo " and "Rójo" are ONE name (mirrors the API's uniqueness rule). */
export function normalizeVariationName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// ── The form's state ──────────────────────────────────────────────────────────────────────────

/** One option value in the form. `id` = a saved value (edit); `key` is what variations reference. */
export interface OptionValueFormRow {
  id?: number;
  key: string;
  name: string;
}

/** One option in the form; array order = `sortOrder` (label order AND photo precedence). */
export interface OptionFormRow {
  id?: number;
  name: string;
  values: OptionValueFormRow[];
}

/** One offered combination in the form. Money/quantity are TEXT (the numeric-field rule); `''` on an
 *  override means "inherit the product's". */
export interface VariantFormRow {
  id?: number;
  valueKeys: string[];
  quantity: string;
  rentPrice: string;
  sellPrice: string;
  replacementPrice: string;
  securityDeposit: string;
  description: string;
  isDefault: boolean;
}

/** The key a SAVED value travels under — stable for the whole edit, so its variations keep it. */
export const valueKeyForId = (id: number): string => `v${id}`;

let mintCounter = 0;
/** A fresh key for a NEW value (`n<k>`), never one already in `taken`. Satisfies the body's
 *  `^[A-Za-z0-9_-]{1,40}$`. */
export function mintValueKey(taken: Iterable<string>): string {
  const used = new Set(taken);
  let key: string;
  do {
    mintCounter += 1;
    key = `n${mintCounter}`;
  } while (used.has(key));
  return key;
}

/** Every value key the options declare. */
export const allValueKeys = (options: OptionFormRow[]): string[] =>
  options.flatMap((option) => option.values.map((value) => value.key));

/** A combination's identity: its keys as a SET (order-free), so `[a, b]` and `[b, a]` are one. */
export const combinationOf = (valueKeys: readonly string[]): string => [...valueKeys].sort().join('|');

/** Every combination of the options' values (one value per option, option order). An option with no
 *  value yet makes the set EMPTY — there is no complete combination to offer. */
export function generateCombinations(options: OptionFormRow[]): string[][] {
  if (options.length === 0) return [];
  return options.reduce<string[][]>(
    (combos, option) =>
      combos.flatMap((combo) => option.values.map((value) => [...combo, value.key])),
    [[]],
  );
}

/** The value keys in OPTION order (unknown keys dropped) — how a variation is shown and labelled. */
export function orderedValueKeys(options: OptionFormRow[], valueKeys: readonly string[]): string[] {
  const set = new Set(valueKeys);
  return options.flatMap((option) =>
    option.values.filter((value) => set.has(value.key)).map((value) => value.key),
  );
}

/** "Rojo · Redondo" for an unsaved combination — the API's `label` rule on the form's state. */
export function variantLabelFor(options: OptionFormRow[], valueKeys: readonly string[]): string {
  const set = new Set(valueKeys);
  return options
    .flatMap((option) => option.values.filter((value) => set.has(value.key)))
    .map((value) => value.name.trim())
    .join(VARIANT_LABEL_SEPARATOR);
}

/** A newly offered combination: no stock typed yet, every override inheriting. */
export const emptyVariantRow = (valueKeys: string[]): VariantFormRow => ({
  valueKeys,
  quantity: '',
  rentPrice: '',
  sellPrice: '',
  replacementPrice: '',
  securityDeposit: '',
  description: '',
  isDefault: false,
});

/**
 * The variations after a value was ADDED to option `optionIndex`:
 * - the option's FIRST value (it had none) completes every existing variation — each gains the new
 *   key and keeps its id, stock and overrides (adding "Tamaño: Redondo" to a coloured product makes
 *   every colour "· Redondo");
 * - any other value — or a first value while nothing is offered yet — OFFERS the combinations it
 *   creates among the options that have values, appended in option order, up to `max`
 *   (the rest stay unoffered — the admin enables them by hand or trims elsewhere).
 * `options` is the state AFTER the add.
 */
export function addValueCombinations(
  options: OptionFormRow[],
  variants: VariantFormRow[],
  optionIndex: number,
  valueKey: string,
  max: number = PRODUCT_MAX_VARIANTS,
): VariantFormRow[] {
  if (options[optionIndex].values.length === 1 && variants.length > 0) {
    return variants.map((variant) => ({ ...variant, valueKeys: [...variant.valueKeys, valueKey] }));
  }
  const offered = new Set(variants.map((variant) => combinationOf(variant.valueKeys)));
  const next = [...variants];
  // Over the options that HAVE values — the same set the editor lists — so a product's very first
  // value (nothing offered yet) offers its combination instead of waiting for a second one.
  for (const combo of generateCombinations(options.filter((option) => option.values.length > 0))) {
    if (next.length >= max) break;
    if (!combo.includes(valueKey) || offered.has(combinationOf(combo))) continue;
    offered.add(combinationOf(combo));
    next.push(emptyVariantRow(combo));
  }
  return next;
}

/** The variations after a value was REMOVED: every variation using it leaves too. */
export const dropValueFromVariants = (variants: VariantFormRow[], valueKey: string): VariantFormRow[] =>
  variants.filter((variant) => !variant.valueKeys.includes(valueKey));

/**
 * The variations after a whole OPTION was removed (`optionKeys` = its values' keys): each variation
 * loses that option's key, and where two collapse into the same combination the FIRST keeps its id,
 * stock and overrides (the rest leave). Removing the last option leaves no variations at all — the
 * product is back to a single stock.
 */
export function dropOptionFromVariants(
  variants: VariantFormRow[],
  optionKeys: readonly string[],
): VariantFormRow[] {
  const removed = new Set(optionKeys);
  const seen = new Set<string>();
  const next: VariantFormRow[] = [];
  for (const variant of variants) {
    const valueKeys = variant.valueKeys.filter((key) => !removed.has(key));
    if (valueKeys.length === 0) continue;
    const combination = combinationOf(valueKeys);
    if (seen.has(combination)) continue;
    seen.add(combination);
    next.push({ ...variant, valueKeys });
  }
  return next;
}

/** A form override over the product's own field: the override when typed, else the inherited text —
 *  what the variation will EFFECTIVELY carry, and what its input shows as a placeholder. */
export const effectiveFormValue = (override: string, inherited: string): string =>
  override.trim() !== '' ? override : inherited;

/** An i18n leaf under `modules.panel.products.create.errors` naming a variation row problem. */
export type VariantIssue =
  | 'invalidVariantQuantity'
  | 'invalidRentPrice'
  | 'invalidSellPrice'
  | 'invalidReplacementPrice'
  | 'invalidSecurityDeposit'
  | 'variantPricingMismatch'
  | 'securityDepositAboveReplacement'
  | 'invalidDescription';

export interface VariantRowContext {
  isRent: boolean;
  /** The product's own replacement / deposit TEXT, inherited by an empty override. */
  productReplacementPrice: string;
  productSecurityDeposit: string;
  /** Money parser: number, `undefined` = blank, `null` = invalid (the form's `parseMoney`). */
  parseMoney: (value: string) => number | undefined | null;
  /** Quantity parser: integer in range, else `null` (the form's `parseQuantity`). */
  parseQuantity: (value: string) => number | null;
  /** The description rule (the product description's). */
  isValidDescription: (value: string) => boolean;
}

const toCents = (value: number | undefined | null): number | undefined =>
  value === undefined || value === null ? undefined : Math.trunc(value * 100) / 100;

/**
 * Every problem with ONE variation row — the API's per-variant rules: stock an integer in range;
 * overrides parse and FOLLOW THE BUSINESS TYPE (Alquiler → rent/replacement/deposit, Venta → sell
 * only, else `variantPricingMismatch`); and on the EFFECTIVE values (override, else the product's)
 * the deposit is never above the replacement. A deposit override of 0 is "none" and always passes.
 */
export function variantRowIssues(
  row: VariantFormRow,
  context: VariantRowContext,
): { field: keyof VariantFormRow; issue: VariantIssue }[] {
  const issues: { field: keyof VariantFormRow; issue: VariantIssue }[] = [];
  if (context.parseQuantity(row.quantity) === null) {
    issues.push({ field: 'quantity', issue: 'invalidVariantQuantity' });
  }
  const moneyFields = [
    ['rentPrice', 'invalidRentPrice'],
    ['sellPrice', 'invalidSellPrice'],
    ['replacementPrice', 'invalidReplacementPrice'],
    ['securityDeposit', 'invalidSecurityDeposit'],
  ] as const;
  const forbidden = new Set<keyof VariantFormRow>(
    context.isRent ? ['sellPrice'] : ['rentPrice', 'replacementPrice', 'securityDeposit'],
  );
  for (const [field, invalid] of moneyFields) {
    const parsed = context.parseMoney(row[field]);
    if (parsed === null) issues.push({ field, issue: invalid });
    else if (parsed !== undefined && forbidden.has(field)) {
      issues.push({ field, issue: 'variantPricingMismatch' });
    }
  }
  if (context.isRent) {
    const deposit = toCents(
      context.parseMoney(effectiveFormValue(row.securityDeposit, context.productSecurityDeposit)),
    );
    const replacement = toCents(
      context.parseMoney(effectiveFormValue(row.replacementPrice, context.productReplacementPrice)),
    );
    if (deposit !== undefined && replacement !== undefined && deposit > replacement) {
      issues.push({ field: 'securityDeposit', issue: 'securityDepositAboveReplacement' });
    }
  }
  const description = row.description.trim();
  if (description !== '' && !context.isValidDescription(description)) {
    issues.push({ field: 'description', issue: 'invalidDescription' });
  }
  return issues;
}

// ── The saved product (read side) ──────────────────────────────────────────────────────────────

/** Does this product sell/rent by variation? (Then a line must name one.) */
export const hasVariants = (product: Pick<Product, 'variants'>): boolean =>
  (product.variants?.length ?? 0) > 0;

/** The variation `variantId` names on this product, if it is still offered. */
export function variantFor(
  product: Pick<Product, 'variants'>,
  variantId: number | null | undefined,
): ProductVariant | undefined {
  if (variantId == null) return undefined;
  return product.variants?.find((variant) => variant.id === variantId);
}

/** The product's default variation (the API flags exactly one; the first as a fallback). */
export const defaultVariant = (product: Pick<Product, 'variants'>): ProductVariant | undefined =>
  product.variants?.find((variant) => variant.isDefault) ?? product.variants?.[0];

/** What a line of this product + variation is priced and deposited at. The API sends a variation's
 *  values already EFFECTIVE, so a variation's fields are taken AS IS — never topped up from the
 *  product's (a deposit override of 0 must not fall back to the product's deposit). */
export function effectivePricing(
  product: Pick<Product, 'rentPrice' | 'sellPrice' | 'securityDeposit' | 'replacementPrice' | 'description'>,
  variant?: ProductVariant,
): {
  rentPrice?: number;
  sellPrice?: number;
  securityDeposit?: number;
  replacementPrice?: number;
  description?: string;
} {
  const source = variant ?? product;
  return {
    rentPrice: source.rentPrice,
    sellPrice: source.sellPrice,
    securityDeposit: source.securityDeposit,
    replacementPrice: source.replacementPrice,
    description: source.description,
  };
}

/** The headline price range over the offered variations (a variation carries only its type's
 *  price — rent for Alquiler, sell for Venta — like `formatProductPrice` reads the product);
 *  `null` without variations or prices. The card shows "Desde Q…" when `min !== max`. */
export function variantPriceRange(
  product: Pick<Product, 'variants'>,
): { min: number; max: number } | null {
  const prices = (product.variants ?? [])
    .map((variant) => variant.rentPrice ?? variant.sellPrice)
    .filter((price): price is number => price !== undefined);
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/** One availability key per (product, variation) pair — line identity on the order side. */
export const stockKey = (productId: number, variantId?: number | null): string =>
  `${productId}:${variantId ?? ''}`;

/** The variation's value per option (option order) — what a line's per-option selects show. */
export function picksForVariant(product: Pick<Product, 'options'>, variant: ProductVariant): (number | null)[] {
  const ids = new Set(variant.valueIds);
  return (product.options ?? []).map(
    (option) => option.values.find((value) => ids.has(value.id))?.id ?? null,
  );
}

/** The variation a COMPLETE set of picks names (one value per option), if it is offered. */
export function matchVariant(
  product: Pick<Product, 'variants' | 'options'>,
  picks: readonly (number | null)[],
): ProductVariant | undefined {
  const optionCount = product.options?.length ?? 0;
  if (optionCount === 0 || picks.length !== optionCount || picks.some((pick) => pick == null)) {
    return undefined;
  }
  const wanted = combinationOf(picks.map(String));
  return product.variants?.find((variant) => combinationOf(variant.valueIds.map(String)) === wanted);
}

/** Is `variant` compatible with the picks made so far (an unpicked option matches anything)? */
export const variantMatchesPicks = (
  product: Pick<Product, 'options'>,
  variant: ProductVariant,
  picks: readonly (number | null)[],
): boolean => {
  const own = picksForVariant(product, variant);
  return picks.every((pick, index) => pick == null || own[index] === pick);
};

/**
 * Which photos the detail page's gallery shows for the current picks (option order): the first
 * picked value that HAS photos gives its set; otherwise the showcase. With nothing picked and no
 * showcase, the DEFAULT variation's photo set — the same photo the grid's tile shows
 * (`coverImageUrl`), so the morph from the card lands on it.
 */
export function photoSetFor(product: Product, picks: readonly (number | null)[]): ProductImage[] {
  const options = product.options ?? [];
  for (const [index, option] of options.entries()) {
    const value = option.values.find((candidate) => candidate.id === picks[index]);
    if (value && value.images.length > 0) return value.images;
  }
  if (product.images.length > 0 || picks.some((pick) => pick != null)) return product.images;
  const fallback = defaultVariant(product);
  if (!fallback) return product.images;
  const ids = new Set(fallback.valueIds);
  for (const option of options) {
    const value = option.values.find((candidate) => ids.has(candidate.id));
    if (value && value.images.length > 0) return value.images;
  }
  return product.images;
}
