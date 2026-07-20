import type { Product } from '../products/product.types';
import { parseDateTime, parseLineQuantity, type OrderMode } from './SchemaCreateOrder';

/** Seeded lookup ids mirrored from the backend enums (stable). */
export const BUSINESS_TYPE_RENT = 1;
export const BUSINESS_TYPE_SELL = 2;
export const RENT_UNIT_DAY = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a product is a rental (drives the mode filter, the pickup rule, and the pricing). */
export const isRentalProduct = (product: Product): boolean =>
  product.businessTypeId === BUSINESS_TYPE_RENT;

/**
 * The products a given MODE lets the picker offer: `rent` → rentals, `buy` → sales, `both` → all.
 * (Filtering by business type, not availability — the admin sees everything; the backend's 409
 * re-offer is the availability guard, EPIC-2 §8.)
 */
export function productsForMode(products: Product[], mode: OrderMode): Product[] {
  if (mode === 'both') return products;
  const wantRental = mode === 'rent';
  return products.filter((product) => isRentalProduct(product) === wantRental);
}

/**
 * Billed days over the delivery→pickup window — mirrors the backend `computeBilledDays`: billing is
 * per day, `< 24h` = 1 day, then one more per STARTED 24h block. `null` inputs (purchase-only, or
 * an unparsed field) yield 1. Kept identical to the server so the estimate can't drift.
 */
export function computeBilledDays(deliveryAt: Date | null, pickupAt: Date | null): number {
  if (!deliveryAt || !pickupAt) return 1;
  return Math.max(1, Math.ceil((pickupAt.getTime() - deliveryAt.getTime()) / DAY_MS));
}

/** One line's ESTIMATED subtotal from its product row (mirrors the backend `priceOrderLine`): a
 *  Día rental bills unit × qty × billed days; other rentals (Evento) bill flat; a sale bills once.
 *  Returns 0 when the product has no applicable price (defensive). */
export function estimateLineSubtotal(product: Product, quantity: number, billedDays: number): number {
  const isRental = isRentalProduct(product);
  const unit = isRental ? product.rentPrice : product.sellPrice;
  if (unit === undefined) return 0;
  const multiplier = isRental && product.rentTimeUnitId === RENT_UNIT_DAY ? billedDays : 1;
  return Math.round(unit * quantity * multiplier * 100) / 100;
}

export interface EstimateLine {
  productId: number;
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
    return sum + estimateLineSubtotal(product, quantity, billedDays);
  }, 0);
  return Math.round((linesTotal + deliveryAmount) * 100) / 100;
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
