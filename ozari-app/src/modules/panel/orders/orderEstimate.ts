import type { Product, ProductVariant } from '../products/product.types';
import { effectivePricing, variantFor } from '../products/productVariations';
import { parseBilledDays, parseDateTime, parseLineQuantity } from './SchemaCreateOrder';

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
 * The order's ESTIMATED gross (lines + delivery fee, BEFORE any discount) for the given billed days —
 * the admin's quote-on-the-phone number. Deliberately labelled an estimate in the UI: it mirrors the
 * backend formula exactly, but the created order's `totalAmount` is authoritative. Unpriceable/unknown
 * lines contribute 0; a blank/invalid quantity counts as 0. `billedDays` is the AGREED figure when
 * the admin set one, else the window's count ({@link effectiveBilledDays}).
 */
export function estimateOrderTotal(
  lines: EstimateLine[],
  productsById: Map<number, Product>,
  billedDays: number,
  deliveryAmount: number,
): number {
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

/** The delivery→pickup window's own day count, or `undefined` while the window is not a real one yet
 *  (a date missing or unparseable, or a pickup not after the delivery) — nothing to fill from. */
export function windowDaysFromStrings(deliveryAt: string, pickupAt: string): number | undefined {
  const delivery = parseDateTime(deliveryAt);
  const pickup = parseDateTime(pickupAt);
  if (!delivery || !pickup || pickup.getTime() <= delivery.getTime()) return undefined;
  return computeBilledDays(delivery, pickup);
}

/**
 * The % helper beside the discount: a percentage of the gross → the AMOUNT the order stores, in
 * cents (truncated like every money value the form sends, so 33.333…% never rounds above what the
 * admin asked). `undefined` for a blank or unusable percentage; capped at 100 % — beyond that the
 * total would go negative.
 */
export function discountFromPercent(percentText: string, gross: number): string | undefined {
  const trimmed = percentText.trim();
  if (trimmed === '') return undefined;
  const percent = Number(trimmed);
  if (!Number.isFinite(percent) || percent < 0) return undefined;
  const amount = Math.trunc(((gross * Math.min(percent, 100)) / 100) * 100) / 100;
  return String(amount);
}

/**
 * The days the rental lines are actually priced for — the API's `resolveBilledDays` for every order
 * it would accept: the AGREED figure when the admin typed a valid one, else the window's own count,
 * else one. A purchase-only order bills once whatever the field holds.
 *
 * The agreed figure counts even before there are dates, which the API never sees (a rental cannot be
 * saved without a pickup): a cotización for "50 sillas por 3 días" is a complete question, and the
 * estimate and the quote must both answer it.
 */
export function effectiveBilledDays(values: {
  deliveryAt: string;
  pickupAt: string;
  billedDays: string;
  anyRental: boolean;
}): number {
  if (!values.anyRental) return 1;
  return (
    parseBilledDays(values.billedDays) ?? windowDaysFromStrings(values.deliveryAt, values.pickupAt) ?? 1
  );
}

/** The total the client pays: the gross less the discount, never below zero (the form refuses a
 *  larger discount; the floor only keeps a transient over-discount from printing a negative total). */
export function applyDiscount(gross: number, discount: number): number {
  return Math.max(0, Math.round((gross - discount) * 100) / 100);
}

const MONEY = new Intl.NumberFormat('es-GT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A money amount as the form shows it — `Q 385.00` (symbol from the picked products' currency). */
export function formatMoney(symbol: string, amount: number): string {
  return `${symbol} ${MONEY.format(amount)}`;
}
