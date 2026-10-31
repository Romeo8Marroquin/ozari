import { PRODUCT_MAX_VARIANTS } from '@constants/Regex';
import type { Product, ProductImage, ProductOptionKind, ProductVariant } from './product.types';

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

/** One option value in the form. `id` = a saved value (edit); `key` is what variations reference.
 *  `color` is its `#rrggbb` (`''` = not picked yet) — kept while the option is generic too, so a
 *  Color → Genérico → Color round trip loses nothing; only a COLOR option sends it. */
export interface OptionValueFormRow {
  id?: number;
  key: string;
  name: string;
  color: string;
}

/** One option in the form; array order = `sortOrder` (label order AND photo precedence). */
export interface OptionFormRow {
  id?: number;
  name: string;
  kind: ProductOptionKind;
  values: OptionValueFormRow[];
}

/** The option kinds, in the order the type select lists them. */
export const OPTION_KINDS: readonly ProductOptionKind[] = ['generic', 'color'];

/** A colour as the API stores it: `#` + six hex digits (the native colour input's own format). */
export const COLOR_HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Does this colour need an OUTLINE to be seen on white? Relative luminance above ~0.8 — whites,
 * creams, "Marfil" — would otherwise melt into the card. Pure arithmetic on the sRGB channels.
 */
export function isLightColor(hex: string): boolean {
  if (!COLOR_HEX_REGEX.test(hex)) return false;
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) > 0.8;
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

/** A combination row's on-screen identity: the key it was given, else its own combination. */
export const rowKeyOf = (
  rowKeys: ReadonlyMap<string, string>,
  valueKeys: readonly string[],
): string => {
  const combination = combinationOf(valueKeys);
  return rowKeys.get(combination) ?? combination;
};

/**
 * Carry each combination ROW's identity across a structural change, so a row that is the same row
 * on screen keeps its React key (and its motion) even though its combination changed: adding an
 * option's FIRST value turns "Rojo" into "Rojo · Grande" (the same variation, one more value), and
 * removing an option MERGES "Rojo · Grande" and "Rojo · Chico" into "Rojo" (the first one survives,
 * exactly as `dropOptionFromVariants` keeps the first variation). Keyed by combination alone, every
 * such row would unmount and remount — the whole table collapsing and re-growing.
 *
 * `before` = the combinations listed before (option order); `project` maps one of them to the
 * combination it becomes, or `null` when it leaves. Returns the identities of the rows that remain
 * (by their NEW combination) and the identities of the rows that leave (gone, or merged away).
 * Combinations that are new after the change are absent — they take their own combination.
 */
export function carryRowKeys(
  before: readonly string[][],
  rowKeys: ReadonlyMap<string, string>,
  project: (valueKeys: readonly string[]) => readonly string[] | null,
): { rowKeys: Map<string, string>; leaving: string[] } {
  const next = new Map<string, string>();
  const leaving: string[] = [];
  for (const combo of before) {
    const key = rowKeyOf(rowKeys, combo);
    const projected = project(combo);
    const target = projected && projected.length > 0 ? combinationOf(projected) : null;
    if (target === null || next.has(target)) {
      leaving.push(key);
      continue;
    }
    next.set(target, key);
  }
  return { rowKeys: next, leaving };
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
  | 'variantPriceRequired'
  | 'invalidDescription';

export interface VariantRowContext {
  isRent: boolean;
  /** One stock on the product (the rows carry none — the API refuses a row quantity then). */
  sharedStock: boolean;
  /** The product's own price / replacement / deposit TEXT, inherited by an empty override. */
  productPrice: string;
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
 * Every problem with ONE variation row — the API's per-variant rules: its own stock an integer in
 * range (unless the stock is SHARED — then the row has none); overrides parse and FOLLOW THE
 * BUSINESS TYPE (Alquiler → rent/replacement/deposit, Venta → sell only, else
 * `variantPricingMismatch`); a PRICE from somewhere — its own, else the product's general one
 * (`variantPriceRequired`, owner 2026-10-30: with variations the general price is only a default);
 * and on the EFFECTIVE values (override, else the product's) the deposit is never above the
 * replacement. A deposit override of 0 is "none" and always passes.
 */
export function variantRowIssues(
  row: VariantFormRow,
  context: VariantRowContext,
): { field: keyof VariantFormRow; issue: VariantIssue }[] {
  const issues: { field: keyof VariantFormRow; issue: VariantIssue }[] = [];
  if (!context.sharedStock && context.parseQuantity(row.quantity) === null) {
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
  // The price the line will be charged at must come from SOMEWHERE. An invalid override (or an
  // invalid general price) already has its own message; only blank-over-blank lands here.
  const priceField = context.isRent ? 'rentPrice' : 'sellPrice';
  if (
    context.parseMoney(row[priceField]) === undefined &&
    context.parseMoney(context.productPrice) === undefined
  ) {
    issues.push({ field: priceField, issue: 'variantPriceRequired' });
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
 *  product's (a deposit override of 0 must not fall back to the product's deposit). The description
 *  is not pricing: a variation's own text STACKS under the product's (see the detail page). */
export function effectivePricing(
  product: Pick<Product, 'rentPrice' | 'sellPrice' | 'securityDeposit' | 'replacementPrice'>,
  variant?: ProductVariant,
): {
  rentPrice?: number;
  sellPrice?: number;
  securityDeposit?: number;
  replacementPrice?: number;
} {
  const source = variant ?? product;
  return {
    rentPrice: source.rentPrice,
    sellPrice: source.sellPrice,
    securityDeposit: source.securityDeposit,
    replacementPrice: source.replacementPrice,
  };
}

/**
 * The stock POOL a line of this product + variation draws from — the API's rule: each variation is
 * its own pool, unless the product's stock is SHARED, where every configuration takes from the one
 * product pool (two lines of the same arrangement, with and without its add-on, compete for it).
 * Line IDENTITY stays the pair (`stockKey`); this is only what availability is counted against.
 */
export const poolKeyOf = (
  product: Pick<Product, 'sharedStock'> | undefined,
  productId: number,
  variantId?: number | null,
): string => stockKey(productId, product?.sharedStock ? null : variantId);

/** The headline price range over the offered variations (a variation carries only its type's
 *  price — rent for Alquiler, sell for Venta — like `formatProductPrice` reads the product);
 *  `null` without variations or prices. The card shows "Desde Q…" when `min !== max`. */
export function variantPriceRange(
  product: Pick<Product, 'variants'>,
): { min: number; max: number } | null {
  return variantRange(product, (variant) => variant.rentPrice ?? variant.sellPrice);
}

/** The range of one EFFECTIVE figure (deposit, replacement…) over the offered variations — what the
 *  detail page says before a pick ("Q50", or "Desde Q50" when they differ); `null` when none has it. */
export function variantRange(
  product: Pick<Product, 'variants'>,
  read: (variant: ProductVariant) => number | undefined,
): { min: number; max: number } | null {
  const values = (product.variants ?? [])
    .map(read)
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** The picked values' names so far, option order — the detail page's title tail as the visitor
 *  picks ("Negro", then "Negro · Redondo"). Unpicked options are skipped. */
export function pickedLabel(product: Pick<Product, 'options'>, picks: readonly (number | null)[]): string {
  return (product.options ?? [])
    .flatMap((option, index) => option.values.filter((value) => value.id === picks[index]))
    .map((value) => value.name)
    .join(VARIANT_LABEL_SEPARATOR);
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

/** The first value of `variant` (option order) that has photos — its set, else `undefined`. */
function variantPhotoSet(
  options: NonNullable<Product['options']>,
  variant: ProductVariant,
): ProductImage[] | undefined {
  const ids = new Set(variant.valueIds);
  for (const option of options) {
    const value = option.values.find((candidate) => ids.has(candidate.id));
    if (value && value.images.length > 0) return value.images;
  }
  return undefined;
}

/**
 * Which photos the detail page's gallery shows for the current picks (option order): the first
 * picked value that HAS photos gives its set; otherwise the showcase. With nothing picked and no
 * showcase, the API's `coverImageUrl` chain (owner 2026-10-30) — the DEFAULT variation's set, else
 * the first variation (canonical order) that has one, else any value's — the same photo the grid's
 * tile shows, so the morph from the card lands on it.
 */
export function photoSetFor(product: Product, picks: readonly (number | null)[]): ProductImage[] {
  const options = product.options ?? [];
  for (const [index, option] of options.entries()) {
    const value = option.values.find((candidate) => candidate.id === picks[index]);
    if (value && value.images.length > 0) return value.images;
  }
  if (product.images.length > 0 || picks.some((pick) => pick != null)) return product.images;
  const variants = product.variants ?? [];
  const fallback = defaultVariant(product);
  const ordered = fallback ? [fallback, ...variants.filter((variant) => variant !== fallback)] : [];
  for (const variant of ordered) {
    const set = variantPhotoSet(options, variant);
    if (set) return set;
  }
  for (const option of options) {
    const value = option.values.find((candidate) => candidate.images.length > 0);
    if (value) return value.images;
  }
  return product.images;
}
