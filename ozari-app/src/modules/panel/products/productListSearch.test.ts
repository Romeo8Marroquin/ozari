import { describe, expect, it } from 'vitest';
import {
  hasActiveFilters,
  parseProductListSearch,
  PRODUCT_SEARCH_MAX_LENGTH,
  toProductListParams,
} from './productListSearch';

describe('parseProductListSearch', () => {
  it('returns an empty state for an empty or junk input', () => {
    expect(parseProductListSearch({})).toEqual({});
    expect(parseProductListSearch({ foo: 'bar', q: 42, categoria: 'abc', tipo: -1, stock: 'x' })).toEqual({});
  });

  it('trims, caps, and keeps a non-empty q', () => {
    expect(parseProductListSearch({ q: '  mesa  ' })).toEqual({ q: 'mesa' });
    expect(parseProductListSearch({ q: '   ' })).toEqual({});
    const long = 'x'.repeat(PRODUCT_SEARCH_MAX_LENGTH + 5);
    expect(parseProductListSearch({ q: long }).q).toHaveLength(PRODUCT_SEARCH_MAX_LENGTH);
  });

  it('keeps positive integer ids (number or numeric string) and drops the rest', () => {
    expect(parseProductListSearch({ categoria: 3, tipo: '1' })).toEqual({ categoria: 3, tipo: 1 });
    expect(parseProductListSearch({ categoria: 0, tipo: 2.5 })).toEqual({});
  });

  it('accepts stock as a boolean or its string form', () => {
    expect(parseProductListSearch({ stock: true })).toEqual({ stock: true });
    expect(parseProductListSearch({ stock: 'false' })).toEqual({ stock: false });
    expect(parseProductListSearch({ stock: 'maybe' })).toEqual({});
  });
});

describe('hasActiveFilters', () => {
  it('is false for the empty state and true when any filter is set', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ q: 'mesa' })).toBe(true);
    expect(hasActiveFilters({ categoria: 1 })).toBe(true);
    expect(hasActiveFilters({ tipo: 2 })).toBe(true);
    expect(hasActiveFilters({ stock: false })).toBe(true);
  });
});

describe('toProductListParams', () => {
  it('maps the URL names to the API names, omitting absent filters', () => {
    expect(toProductListParams({})).toEqual({});
    expect(toProductListParams({ q: 'mesa', categoria: 3, tipo: 1, stock: false })).toEqual({
      search: 'mesa',
      categoryId: 3,
      businessTypeId: 1,
      inStock: false,
    });
  });
});
