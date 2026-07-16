import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatProductPrice,
  primaryImageIndex,
  primaryImageUrl,
} from './productPresentation';
import type { Product } from './product.types';

const base: Product = {
  id: 1,
  name: 'Mesa redonda',
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Mesas',
  categoryId: 1,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  images: [],
  details: [],
};

describe('formatMoney', () => {
  it('prefixes the symbol to a plain amount', () => {
    expect(formatMoney(75, 'Q')).toBe('Q75');
  });

  it('groups thousands', () => {
    expect(formatMoney(1250, 'Q')).toBe('Q1,250');
  });
});

describe('formatProductPrice', () => {
  it('shows the rental price with its period', () => {
    expect(formatProductPrice({ ...base, rentPrice: 75, rentTimeUnit: 'Día' })).toBe('Q75 / Día');
  });

  it('shows the rental price without a period when the unit is absent', () => {
    expect(formatProductPrice({ ...base, rentPrice: 75 })).toBe('Q75');
  });

  it('falls back to the sale price when there is no rental price', () => {
    expect(formatProductPrice({ ...base, sellPrice: 1200 })).toBe('Q1,200');
  });

  it('returns null when neither price is present', () => {
    expect(formatProductPrice(base)).toBeNull();
  });
});

describe('primaryImageIndex / primaryImageUrl', () => {
  const gallery = [
    { id: 3, url: 'https://cdn/x.webp', isPrimary: false, sortOrder: 0 },
    { id: 4, url: 'https://cdn/y.webp', isPrimary: false, sortOrder: 1 },
    { id: 5, url: 'https://cdn/z.webp', isPrimary: true, sortOrder: 2 },
  ];

  it('finds the FLAGGED photo wherever it sits — the star is independent of the order', () => {
    const product = { ...base, images: gallery };
    expect(primaryImageIndex(product)).toBe(2);
    expect(primaryImageUrl(product)).toBe('https://cdn/z.webp');
  });

  it('falls back to the first image when no photo carries the flag', () => {
    const flagless = gallery.map((image) => ({ ...image, isPrimary: false }));
    const product = { ...base, images: flagless };
    expect(primaryImageIndex(product)).toBe(0);
    expect(primaryImageUrl(product)).toBe('https://cdn/x.webp');
  });

  it('returns null when the product has no images', () => {
    expect(primaryImageIndex(base)).toBe(0);
    expect(primaryImageUrl(base)).toBeNull();
  });
});
