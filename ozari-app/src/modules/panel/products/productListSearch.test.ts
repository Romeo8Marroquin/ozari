import { describe, expect, it } from 'vitest';
import {
  hasActiveFilters,
  parseProductListSearch,
  PRODUCT_LIST_ORDERS,
  PRODUCT_SEARCH_MAX_LENGTH,
  toProductListParams,
} from './productListSearch';

describe('parseProductListSearch', () => {
  it('returns an empty state for an empty or junk input', () => {
    expect(parseProductListSearch({})).toEqual({});
    expect(parseProductListSearch({ foo: 'bar', q: 42, categoria: 'abc', tipo: -1, orden: 'x' })).toEqual({});
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

  it('keeps only an allowlisted order (anything else means the default, i.e. absent)', () => {
    for (const orden of PRODUCT_LIST_ORDERS) {
      expect(parseProductListSearch({ orden })).toEqual({ orden });
    }
    expect(parseProductListSearch({ orden: 'recientes' })).toEqual({}); // the default is absence
    expect(parseProductListSearch({ orden: 'precio' })).toEqual({});
    expect(parseProductListSearch({ orden: 3 })).toEqual({});
  });
});

describe('hasActiveFilters', () => {
  it('is false for the empty state and true when any filter or order is set', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ q: 'mesa' })).toBe(true);
    expect(hasActiveFilters({ categoria: 1 })).toBe(true);
    expect(hasActiveFilters({ tipo: 2 })).toBe(true);
    expect(hasActiveFilters({ orden: 'precio-menor' })).toBe(true);
  });
});

describe('toProductListParams', () => {
  it('maps the URL names to the API names, omitting absent filters', () => {
    expect(toProductListParams({})).toEqual({});
    expect(toProductListParams({ q: 'mesa', categoria: 3, tipo: 1, orden: 'precio-menor' })).toEqual({
      search: 'mesa',
      categoryId: 3,
      businessTypeId: 1,
      sort: 'priceAsc',
    });
  });

  it('translates every URL order to its API sort value', () => {
    expect(toProductListParams({ orden: 'nombre-az' })).toEqual({ sort: 'nameAsc' });
    expect(toProductListParams({ orden: 'nombre-za' })).toEqual({ sort: 'nameDesc' });
    expect(toProductListParams({ orden: 'precio-menor' })).toEqual({ sort: 'priceAsc' });
    expect(toProductListParams({ orden: 'precio-mayor' })).toEqual({ sort: 'priceDesc' });
  });
});
