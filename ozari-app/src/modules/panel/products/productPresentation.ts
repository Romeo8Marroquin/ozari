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

/** The primary image URL (backend orders images primary-first), or `null` when the product has none. */
export function primaryImageUrl(product: Product): string | null {
  return product.images[0]?.url ?? null;
}
