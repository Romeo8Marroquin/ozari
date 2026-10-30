import type { Product, ProductOptionValue, ProductVariant } from '../products/product.types';
import { picksForVariant, variantFor, variantMatchesPicks } from '../products/productVariations';

/**
 * The order form's per-line VARIATION picker, as pure decisions: a line of a product with
 * variations shows one select per option (option order), cascading — each option offers only the
 * values that, together with the picks made in the options BEFORE it, still lead to a variation the
 * line may take. A complete set of picks resolves to a variation (`matchVariant`); until then the
 * partial picks ride the line as the form-only `pickedValues`.
 */

/** A line's picks: its variation's values when it names an offered one, else the partial picks it
 *  carries, padded/trimmed to one entry per option. */
export function currentPicks(
  product: Pick<Product, 'options' | 'variants'>,
  line: { variantId: number | null; pickedValues?: readonly (number | null)[] },
): (number | null)[] {
  const variant = variantFor(product, line.variantId);
  if (variant) return picksForVariant(product, variant);
  return (product.options ?? []).map((_, index) => line.pickedValues?.[index] ?? null);
}

/**
 * The picks after option `optionIndex` was set to `valueId` (`null` = cleared): every LATER pick
 * that no variation the line may take (`selectable`, as in {@link valueChoices}) can combine with
 * the earlier ones any more is cleared, so the cascade never keeps a value that leads nowhere.
 */
export function nextPicks(
  product: Pick<Product, 'options' | 'variants'>,
  picks: readonly (number | null)[],
  optionIndex: number,
  valueId: number | null,
  selectable: (variant: ProductVariant) => boolean = () => true,
): (number | null)[] {
  const next = [...picks];
  next[optionIndex] = valueId;
  const variants = (product.variants ?? []).filter(selectable);
  for (let index = optionIndex + 1; index < next.length; index += 1) {
    if (next[index] == null) continue;
    const prefix = next.slice(0, index + 1);
    if (!variants.some((variant) => variantMatchesPicks(product, variant, prefix))) next[index] = null;
  }
  return next;
}

/**
 * The values option `optionIndex` offers: those of some variation that matches the picks made in
 * the options BEFORE it and that the line may take (`selectable` — unused by another line and
 * offerable; the line's own variation always is). The value currently picked there always stays
 * listed, so the select never silently empties.
 */
export function valueChoices(
  product: Pick<Product, 'options' | 'variants'>,
  picks: readonly (number | null)[],
  optionIndex: number,
  selectable: (variant: ProductVariant) => boolean,
): ProductOptionValue[] {
  const option = product.options?.[optionIndex];
  if (!option) return [];
  const prefix = picks.slice(0, optionIndex);
  const reachable = new Set<number>();
  (product.variants ?? []).forEach((variant) => {
    if (!selectable(variant) || !variantMatchesPicks(product, variant, prefix)) return;
    const own = picksForVariant(product, variant)[optionIndex];
    if (own != null) reachable.add(own);
  });
  return option.values.filter(
    (value) => reachable.has(value.id) || value.id === picks[optionIndex],
  );
}
