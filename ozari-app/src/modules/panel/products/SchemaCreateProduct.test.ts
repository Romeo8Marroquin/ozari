import { describe, expect, it } from 'vitest';
import {
  BUSINESS_TYPE_RENT,
  BUSINESS_TYPE_SELL,
  createProductDefaultValues,
  createProductRequiredPatterns,
  createProductSchema,
  parseMoney,
  parseQuantity,
  toCreateProductBody,
  type CreateProductFormType,
} from './SchemaCreateProduct';

const validRent = (): CreateProductFormType => ({
  name: 'Mesa redonda',
  description: 'Mesa para 8 personas',
  businessTypeId: BUSINESS_TYPE_RENT,
  categoryId: 1,
  currencyId: 1,
  quantity: '40',
  rentPrice: '75',
  rentTimeUnitId: 2,
  replacementPrice: '900',
  sellPrice: '',
  details: [{ detailTypeId: 1, detail: 'Blanco nieve' }],
});

const validSell = (): CreateProductFormType => ({
  ...validRent(),
  businessTypeId: BUSINESS_TYPE_SELL,
  rentPrice: '',
  rentTimeUnitId: undefined,
  replacementPrice: '',
  sellPrice: '12.5',
  details: [],
});

const errorPaths = (data: CreateProductFormType): string[] => {
  const result = createProductSchema.safeParse(data);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('parseMoney', () => {
  it('maps absence, validity and violations', () => {
    expect(parseMoney('')).toBeUndefined();
    expect(parseMoney('  ')).toBeUndefined();
    expect(parseMoney('75.5')).toBe(75.5);
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('-1')).toBeNull();
    expect(parseMoney('1000001')).toBeNull();
    expect(parseMoney('Infinity')).toBeNull();
  });
});

describe('parseQuantity', () => {
  it('requires an integer within range', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('40')).toBe(40);
    expect(parseQuantity('0')).toBe(0);
    expect(parseQuantity('2.5')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
    expect(parseQuantity('5001')).toBeNull();
  });
});

describe('createProductSchema', () => {
  it('accepts a valid Alquiler product', () => {
    expect(createProductSchema.safeParse(validRent()).success).toBe(true);
  });

  it('accepts a valid Venta product (no description needed)', () => {
    expect(createProductSchema.safeParse({ ...validSell(), description: '' }).success).toBe(true);
  });

  it('rejects a missing/short/invalid name', () => {
    expect(errorPaths({ ...validRent(), name: '' })).toContain('name');
    expect(errorPaths({ ...validRent(), name: 'x' })).toContain('name');
    expect(errorPaths({ ...validRent(), name: 'mal@nombre!' })).toContain('name');
  });

  it('rejects a malformed description but allows an empty one', () => {
    expect(errorPaths({ ...validRent(), description: '<script>' })).toContain('description');
    expect(createProductSchema.safeParse({ ...validRent(), description: undefined }).success).toBe(true);
  });

  it('rejects missing selects (category) and bad numerics', () => {
    expect(errorPaths({ ...validRent(), categoryId: undefined as never })).toContain('categoryId');
    expect(errorPaths({ ...validRent(), quantity: '2.5' })).toContain('quantity');
    expect(errorPaths({ ...validRent(), rentPrice: '-5' })).toContain('rentPrice');
    expect(errorPaths({ ...validRent(), replacementPrice: 'abc' })).toContain('replacementPrice');
    expect(errorPaths({ ...validSell(), sellPrice: '1000001' })).toContain('sellPrice');
  });

  it('validates detail rows (type required, text mirrored to the name rule)', () => {
    expect(
      errorPaths({ ...validRent(), details: [{ detailTypeId: undefined as never, detail: 'Blanco nieve' }] }),
    ).toContain('details.0.detailTypeId');
    expect(errorPaths({ ...validRent(), details: [{ detailTypeId: 1, detail: '' }] })).toContain(
      'details.0.detail',
    );
    expect(errorPaths({ ...validRent(), details: [{ detailTypeId: 1, detail: '@@@' }] })).toContain(
      'details.0.detail',
    );
  });

  describe('the conditional price rule', () => {
    it('Alquiler requires rentPrice + rentTimeUnit and forbids sellPrice', () => {
      expect(errorPaths({ ...validRent(), rentPrice: '' })).toContain('rentPrice');
      expect(errorPaths({ ...validRent(), rentTimeUnitId: undefined })).toContain('rentTimeUnitId');
      // `null` is the select's empty-selection sentinel — equally "missing".
      expect(errorPaths({ ...validRent(), rentTimeUnitId: null as never })).toContain('rentTimeUnitId');
      expect(errorPaths({ ...validRent(), sellPrice: '100' })).toContain('sellPrice');
    });

    it('Venta requires sellPrice and forbids rentPrice', () => {
      expect(errorPaths({ ...validSell(), sellPrice: '' })).toContain('sellPrice');
      expect(errorPaths({ ...validSell(), rentPrice: '75' })).toContain('rentPrice');
    });

    it('treats fully ABSENT price fields like empty ones (optional strings)', () => {
      expect(errorPaths({ ...validRent(), rentPrice: undefined })).toContain('rentPrice');
      expect(errorPaths({ ...validSell(), sellPrice: undefined })).toContain('sellPrice');
    });

    it('an unknown business type adds no conditional issues (the select only offers real ones)', () => {
      const result = createProductSchema.safeParse({ ...validSell(), businessTypeId: 99 });
      expect(result.success).toBe(true);
    });
  });
});

describe('toCreateProductBody', () => {
  it('maps an Alquiler form: truncated money, trimmed text, no sell fields', () => {
    const body = toCreateProductBody({
      ...validRent(),
      name: '  Mesa redonda  ',
      rentPrice: '75.999',
      replacementPrice: '900.555',
      details: [{ detailTypeId: 1, detail: '  Blanco nieve  ' }],
    });
    expect(body).toEqual({
      name: 'Mesa redonda',
      description: 'Mesa para 8 personas',
      businessTypeId: BUSINESS_TYPE_RENT,
      categoryId: 1,
      currencyId: 1,
      quantity: 40,
      rentPrice: 75.99,
      rentTimeUnitId: 2,
      replacementPrice: 900.55,
      productDetails: [{ detailTypeId: 1, detail: 'Blanco nieve' }],
    });
  });

  it('maps a Venta form: sell fields only, empty optionals omitted', () => {
    const body = toCreateProductBody({ ...validSell(), description: '' });
    expect(body).toEqual({
      name: 'Mesa redonda',
      businessTypeId: BUSINESS_TYPE_SELL,
      categoryId: 1,
      currencyId: 1,
      quantity: 40,
      sellPrice: 12.5,
      productDetails: [],
    });
    expect(body).not.toHaveProperty('rentPrice');
    expect(body).not.toHaveProperty('replacementPrice');
    expect(body).not.toHaveProperty('description');
  });

  it('degrades unparseable leftovers defensively (invalid money → omitted, quantity → 0)', () => {
    const body = toCreateProductBody({ ...validSell(), replacementPrice: 'abc', quantity: 'x' });
    expect(body).not.toHaveProperty('replacementPrice');
    expect(body.quantity).toBe(0);
  });

  it('tolerates absent optional strings and the null rent unit sentinel', () => {
    const noDescription = toCreateProductBody({ ...validSell(), description: undefined });
    expect(noDescription).not.toHaveProperty('description');

    // A fully ABSENT price string maps like an empty one (money(undefined) → omitted).
    const absentReplacement = toCreateProductBody({ ...validSell(), replacementPrice: undefined });
    expect(absentReplacement).not.toHaveProperty('replacementPrice');

    const nullUnit = toCreateProductBody({ ...validRent(), rentTimeUnitId: null as never });
    expect(nullUnit.rentTimeUnitId).toBeUndefined();
  });
});

describe('required patterns', () => {
  it('marks the required fields and skips the optional ones', () => {
    const matches = (name: string) =>
      createProductRequiredPatterns.some((pattern) => pattern.test(name));
    expect(matches('name')).toBe(true);
    expect(matches('categoryId')).toBe(true);
    expect(matches('quantity')).toBe(true);
    expect(matches('description')).toBe(false);
    expect(matches('rentPrice')).toBe(false);
    expect(matches('replacementPrice')).toBe(false);
  });

  it('exposes pristine defaults (Alquiler, Día, GTQ, no details)', () => {
    expect(createProductDefaultValues.businessTypeId).toBe(BUSINESS_TYPE_RENT);
    expect(createProductDefaultValues.rentTimeUnitId).toBe(2);
    expect(createProductDefaultValues.currencyId).toBe(1);
    expect(createProductDefaultValues.details).toEqual([]);
  });
});
