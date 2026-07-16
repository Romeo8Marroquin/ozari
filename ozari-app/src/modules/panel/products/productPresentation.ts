import type { Product } from './product.types';

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
