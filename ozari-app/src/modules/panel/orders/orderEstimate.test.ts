import { describe, expect, it } from 'vitest';
import type { Product } from '../products/product.types';
import {
  applyDiscount,
  billedDaysFromStrings,
  computeBilledDays,
  discountFromPercent,
  effectiveBilledDays,
  windowDaysFromStrings,
  estimateDepositTotal,
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
      2,
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
      1,
      0,
    );
    expect(total).toBe(0);
  });
});

describe('estimateDepositTotal', () => {
  it('sums rental deposits × quantity — never a sale, a deposit-less rental or a bad quantity', () => {
    const productsById = new Map<number, Product>([
      [3, rental({ securityDeposit: 12.5 })],
      [5, rental({ id: 5, securityDeposit: undefined })],
      // A sale can't carry one (the API forbids it); were one to slip through, it still counts 0.
      [4, sale({ securityDeposit: 99 })],
    ]);
    expect(
      estimateDepositTotal(
        [
          { productId: 3, quantity: '10' },
          { productId: 5, quantity: '4' },
          { productId: 4, quantity: '2' },
          { productId: 3, quantity: 'x' },
          { productId: 999, quantity: '1' },
        ],
        productsById,
      ),
    ).toBe(125);
    expect(estimateDepositTotal([], productsById)).toBe(0);
  });
});

describe('VARIATIONS — effective prices and deposits', () => {
  // A tablecloth whose Rojo overrides the price and drops the deposit (0 = none); Azul inherits.
  const variants = [
    { id: 71, valueIds: [1], label: 'Rojo', isDefault: false, rentPrice: 9, securityDeposit: 0 },
    { id: 72, valueIds: [2], label: 'Azul', isDefault: true, rentPrice: 6, securityDeposit: 20 },
  ];
  const mantel = rental({ id: 7, securityDeposit: 20, variants });
  const productsById = new Map<number, Product>([[7, mantel]]);

  it('prices a line at its variation (and the product without one)', () => {
    expect(lineUnitPrice(mantel, variants[0])).toBe(9);
    expect(lineUnitPrice(mantel)).toBe(6);
    expect(estimateLineSubtotal(mantel, 2, 3, variants[0])).toBe(54);
    expect(
      estimateOrderTotal(
        [
          { productId: 7, variantId: 71, quantity: '2' },
          { productId: 7, variantId: 72, quantity: '1' },
        ],
        productsById,
        1,
        0,
      ),
    ).toBe(24);
  });

  it('deposits per variation — a 0 override is none, never topped up from the product', () => {
    expect(
      estimateDepositTotal(
        [
          { productId: 7, variantId: 71, quantity: '5' },
          { productId: 7, variantId: 72, quantity: '2' },
        ],
        productsById,
      ),
    ).toBe(40);
  });
});

describe('windowDaysFromStrings', () => {
  it('counts a real window and has nothing to say otherwise', () => {
    expect(windowDaysFromStrings('2026-08-01T14:00', '2026-08-04T10:00')).toBe(3);
    expect(windowDaysFromStrings('2026-08-01T14:00', '')).toBeUndefined();
    expect(windowDaysFromStrings('', '2026-08-04T10:00')).toBeUndefined();
    // A pickup not after the delivery is a mistake in progress, not a 1-day rental.
    expect(windowDaysFromStrings('2026-08-01T14:00', '2026-08-01T14:00')).toBeUndefined();
  });
});

describe('effectiveBilledDays — the API resolveBilledDays mirror', () => {
  const window = { deliveryAt: '2026-08-01T14:00', pickupAt: '2026-08-04T10:00', anyRental: true };

  it('takes the agreed figure when the field holds a valid one', () => {
    expect(effectiveBilledDays({ ...window, billedDays: '1' })).toBe(1);
  });

  it('falls back to the window for a blank or invalid figure', () => {
    expect(effectiveBilledDays({ ...window, billedDays: '' })).toBe(3);
    expect(effectiveBilledDays({ ...window, billedDays: '0' })).toBe(3);
  });

  it('bills once when nothing is rented, or with neither a figure nor a window', () => {
    expect(effectiveBilledDays({ ...window, billedDays: '5', anyRental: false })).toBe(1);
    expect(effectiveBilledDays({ ...window, pickupAt: '', billedDays: '' })).toBe(1);
  });

  it('honours an agreed figure before there are dates (a quote for "3 días")', () => {
    expect(effectiveBilledDays({ deliveryAt: '', pickupAt: '', billedDays: '3', anyRental: true })).toBe(3);
  });
});

describe('discount helpers', () => {
  it('subtracts the discount, never below zero', () => {
    expect(applyDiscount(385, 85)).toBe(300);
    expect(applyDiscount(385, 385)).toBe(0);
    expect(applyDiscount(100, 150)).toBe(0);
  });

  it('turns a percentage of the gross into an amount truncated to cents, capped at 100 %', () => {
    expect(discountFromPercent('10', 385)).toBe('38.5');
    expect(discountFromPercent('33.333', 100)).toBe('33.33');
    expect(discountFromPercent('150', 200)).toBe('200');
    expect(discountFromPercent('', 200)).toBeUndefined();
    // The middle of typing ".5" — nothing to convert yet.
    expect(discountFromPercent('.', 200)).toBeUndefined();
    expect(discountFromPercent('-5', 200)).toBeUndefined();
    expect(discountFromPercent('abc', 200)).toBeUndefined();
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
