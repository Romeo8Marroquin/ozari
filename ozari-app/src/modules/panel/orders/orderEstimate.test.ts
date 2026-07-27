import { describe, expect, it } from 'vitest';
import type { Product } from '../products/product.types';
import {
  billedDaysFromStrings,
  computeBilledDays,
  estimateLineSubtotal,
  estimateOrderTotal,
  formatMoney,
  isRentalProduct,
  lineUnitPrice,
} from './orderEstimate';

const rental = (overrides: Partial<Product> = {}): Product => ({
  id: 3,
  name: 'Silla plegable',
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Sillas',
  categoryId: 2,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 6,
  rentTimeUnit: 'Día',
  rentTimeUnitId: 2,
  images: [],
  details: [],
  ...overrides,
});

const sale = (overrides: Partial<Product> = {}): Product => ({
  id: 4,
  name: 'Vasos',
  businessType: 'Venta',
  businessTypeId: 2,
  category: 'Accesorios',
  categoryId: 5,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  sellPrice: 3.5,
  images: [],
  details: [],
  ...overrides,
});

describe('isRentalProduct', () => {
  it('flags rentals vs sales by business type', () => {
    expect(isRentalProduct(rental())).toBe(true);
    expect(isRentalProduct(sale())).toBe(false);
  });
});

describe('computeBilledDays', () => {
  it('bills one day up to 24h, then one per started block', () => {
    const start = new Date('2026-08-01T14:00:00');
    expect(computeBilledDays(start, new Date('2026-08-01T16:00:00'))).toBe(1);
    expect(computeBilledDays(start, new Date('2026-08-02T14:00:00'))).toBe(1);
    expect(computeBilledDays(start, new Date('2026-08-02T14:01:00'))).toBe(2);
    expect(computeBilledDays(null, null)).toBe(1);
    expect(computeBilledDays(start, null)).toBe(1);
  });
});

describe('estimateLineSubtotal', () => {
  it('bills a Día rental per day, a flat (Evento) rental once, and a sale once', () => {
    expect(estimateLineSubtotal(rental(), 25, 2)).toBe(300);
    expect(estimateLineSubtotal(rental({ rentTimeUnitId: 5, rentPrice: 150 }), 2, 3)).toBe(300);
    expect(estimateLineSubtotal(sale(), 10, 4)).toBe(35);
  });

  it('returns 0 when the product lacks its applicable price', () => {
    expect(estimateLineSubtotal(rental({ rentPrice: undefined }), 5, 2)).toBe(0);
  });
});

describe('lineUnitPrice', () => {
  it('returns the rent price for a rental, the sell price for a sale, and 0 when absent', () => {
    expect(lineUnitPrice(rental())).toBe(6);
    expect(lineUnitPrice(sale())).toBe(3.5);
    expect(lineUnitPrice(rental({ rentPrice: undefined }))).toBe(0);
  });
});

describe('estimateOrderTotal', () => {
  const productsById = new Map<number, Product>([
    [3, rental()],
    [4, sale()],
  ]);

  it('sums priced lines over the window and adds the delivery fee', () => {
    const total = estimateOrderTotal(
      [
        { productId: 3, quantity: '25' },
        { productId: 4, quantity: '10' },
      ],
      productsById,
      new Date('2026-08-01T14:00:00'),
      new Date('2026-08-02T15:00:00'),
      50,
    );
    // rental 6×25×2 = 300, sale 3.5×10 = 35, +50 = 385
    expect(total).toBe(385);
  });

  it('ignores unknown products and blank/invalid quantities', () => {
    const total = estimateOrderTotal(
      [
        { productId: 3, quantity: '' },
        { productId: 999, quantity: '5' },
      ],
      productsById,
      null,
      null,
      0,
    );
    expect(total).toBe(0);
  });
});

describe('billedDaysFromStrings / formatMoney', () => {
  it('adapts raw datetime strings', () => {
    expect(billedDaysFromStrings('2026-08-01T14:00', '2026-08-02T15:00')).toBe(2);
    expect(billedDaysFromStrings('', '')).toBe(1);
  });

  it('formats money with the currency symbol', () => {
    expect(formatMoney('Q', 385)).toBe('Q 385.00');
    expect(formatMoney('$', 0)).toBe('$ 0.00');
  });
});
