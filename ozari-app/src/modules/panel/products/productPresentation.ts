import type { Product } from './product.types';
import { variantPriceRange } from './productVariations';

/**
 * Display helpers for a product tile. Pure formatting only — the role→field decisions live in the
 * backend projection (see {@link Product}); here we just render whatever fields arrived.
 */

/** A money amount as `symbol + localized number` (e.g. `Q1,250`). Guatemala groups thousands with commas. */
export function formatMoney(amount: number, symbol: string): string {
  return `${symbol}${amount.toLocaleString('es-GT')}`;
}

/**
 * The product's headline price string, chosen by how it's sold: a rental shows its price **and the
 * period** (`Q75 / Día`), a sale shows a flat price (`Q1,250`). Returns `null` when neither price is
 * present (nothing to show), so the caller can omit the price line entirely.
 */
export function formatProductPrice(product: Product): string | null {
  const { currency, rentPrice, sellPrice, rentTimeUnit } = product;
  if (rentPrice !== undefined) {
    const price = formatMoney(rentPrice, currency.symbol);
    return rentTimeUnit ? `${price} / ${rentTimeUnit}` : price;
  }
  if (sellPrice !== undefined) {
    return formatMoney(sellPrice, currency.symbol);
  }
  return null;
}

/**
 * The headline price with variations taken into account (their prices arrive EFFECTIVE): one shared
 * variation price shows plainly, differing ones show the LOWEST with `from: true` (the caller words
 * it "Desde Q50 / Día"). Without variations it is `formatProductPrice`. `null` = nothing to show.
 */
export function formatHeadlinePrice(product: Product): { price: string; from: boolean } | null {
  const range = variantPriceRange(product);
  if (!range) {
    const price = formatProductPrice(product);
    return price === null ? null : { price, from: false };
  }
  // A variation carries its type's price only — the side they have is the side the lowest price goes
  // on (a rental keeps its period). Read off the VARIATIONS: with variations the product's own price
  // is an optional default and may be absent.
  /* v8 ignore next -- `?? []`: a price range means the product carries variants */
  const isRental = (product.variants ?? []).some((variant) => variant.rentPrice !== undefined);
  const lowest = isRental
    ? (formatProductPrice({ ...product, rentPrice: range.min }) as string)
    : formatMoney(range.min, product.currency.symbol);
  return { price: lowest, from: range.min !== range.max };
}

/**
 * The FLAGGED primary image's index in the gallery, or `0` when none is flagged. Images arrive in
 * display order (`sortOrder`) and the star may sit anywhere in it — the card shows this photo and
 * the detail page opens on it, without reordering the gallery around it.
 */
export function primaryImageIndex(product: Pick<Product, 'images'>): number {
  return Math.max(
    product.images.findIndex((image) => image.isPrimary),
    0,
  );
}

/** The primary (flagged, else first) image URL, or `null` when the product has none. */
export function primaryImageUrl(product: Product): string | null {
  return product.images[primaryImageIndex(product)]?.url ?? null;
}
