import type { Product, ProductVariant } from '../products/product.types';
import { effectivePricing, variantFor } from '../products/productVariations';
import { parseDateTime, parseLineQuantity } from './SchemaCreateOrder';

/** Seeded lookup ids mirrored from the backend enums (stable). */
export const BUSINESS_TYPE_RENT = 1;
export const BUSINESS_TYPE_SELL = 2;
export const RENT_UNIT_DAY = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a product is a rental (drives the pickup rule and the pricing). */
export const isRentalProduct = (product: Product): boolean =>
  product.businessTypeId === BUSINESS_TYPE_RENT;

/**
 * Billed days over the delivery→pickup window — mirrors the backend `computeBilledDays`: billing is
 * per day, `< 24h` = 1 day, then one more per STARTED 24h block. `null` inputs (purchase-only, or
 * an unparsed field) yield 1. Kept identical to the server so the estimate can't drift.
 */
export function computeBilledDays(deliveryAt: Date | null, pickupAt: Date | null): number {
  if (!deliveryAt || !pickupAt) return 1;
  return Math.max(1, Math.ceil((pickupAt.getTime() - deliveryAt.getTime()) / DAY_MS));
}

/** One line's UNIT price from its product row — or its VARIATION's effective one (the API sends a
 *  variation's prices already effective); 0 when it has no applicable price. */
export function lineUnitPrice(product: Product, variant?: ProductVariant): number {
  const pricing = effectivePricing(product, variant);
  const unit = isRentalProduct(product) ? pricing.rentPrice : pricing.sellPrice;
  return unit ?? 0;
}

/** One line's ESTIMATED subtotal from its product row (mirrors the backend `priceOrderLine`): a
 *  Día rental bills unit × qty × billed days; other rentals (Evento) bill flat; a sale bills once.
 *  A line holding a VARIATION is priced at the variation's effective price. Returns 0 when there is
 *  no applicable price (defensive). */
export function estimateLineSubtotal(
  product: Product,
  quantity: number,
  billedDays: number,
  variant?: ProductVariant,
): number {
  const isRental = isRentalProduct(product);
  const pricing = effectivePricing(product, variant);
  const unit = isRental ? pricing.rentPrice : pricing.sellPrice;
  if (unit === undefined) return 0;
  const multiplier = isRental && product.rentTimeUnitId === RENT_UNIT_DAY ? billedDays : 1;
  return Math.round(unit * quantity * multiplier * 100) / 100;
}

export interface EstimateLine {
  productId: number;
  /** The line's variation (`null`/absent = none) — its effective price and deposit apply. */
  variantId?: number | null;
  quantity: string;
}

/**
 * The order's ESTIMATED total from the current lines + delivery window + delivery fee — the admin's
 * quote-on-the-phone number. Deliberately labelled an estimate in the UI: it mirrors the backend
 * formula exactly, but the created order's `totalAmount` is authoritative. Unpriceable/unknown
 * lines contribute 0; a blank/invalid quantity counts as 0.
 */
export function estimateOrderTotal(
  lines: EstimateLine[],
  productsById: Map<number, Product>,
  deliveryAt: Date | null,
  pickupAt: Date | null,
  deliveryAmount: number,
): number {
  const billedDays = computeBilledDays(deliveryAt, pickupAt);
  const linesTotal = lines.reduce((sum, line) => {
    const product = productsById.get(line.productId);
    const quantity = parseLineQuantity(line.quantity);
    if (!product || quantity === null) return sum;
    return sum + estimateLineSubtotal(product, quantity, billedDays, variantFor(product, line.variantId));
  }, 0);
  return Math.round((linesTotal + deliveryAmount) * 100) / 100;
}

/**
 * The order's refundable SECURITY DEPOSIT from the current lines — Σ (rental product's deposit per
 * unit × quantity), exactly what the API snapshots on save (`computeDepositTotal`). It is collected
 * ON TOP of the order and given back at pickup, so it never joins {@link estimateOrderTotal}. A sale
 * line, a rental without a deposit and a blank/invalid quantity contribute 0.
 */
export function estimateDepositTotal(lines: EstimateLine[], productsById: Map<number, Product>): number {
  const total = lines.reduce((sum, line) => {
    const product = productsById.get(line.productId);
    const quantity = parseLineQuantity(line.quantity);
    if (!product || quantity === null || !isRentalProduct(product)) return sum;
    const { securityDeposit } = effectivePricing(product, variantFor(product, line.variantId));
    return sum + (securityDeposit ?? 0) * quantity;
  }, 0);
  return Math.round(total * 100) / 100;
}

/** Billed days from the raw datetime-local strings (a thin adapter over {@link computeBilledDays}). */
export function billedDaysFromStrings(deliveryAt: string, pickupAt: string): number {
  return computeBilledDays(parseDateTime(deliveryAt), parseDateTime(pickupAt));
}

const MONEY = new Intl.NumberFormat('es-GT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A money amount as the form shows it — `Q 385.00` (symbol from the picked products' currency). */
export function formatMoney(symbol: string, amount: number): string {
  return `${symbol} ${MONEY.format(amount)}`;
}
