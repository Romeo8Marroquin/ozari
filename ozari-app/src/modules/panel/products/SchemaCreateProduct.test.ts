import { describe, expect, it } from 'vitest';
import {
  BUSINESS_TYPE_RENT,
  BUSINESS_TYPE_SELL,
  createProductDefaultValues,
  createProductRequiredPatterns,
  createProductSchema,
  parseMoney,
  parseQuantity,
  productToFormValues,
  toCreateProductBody,
  toUpdateProductBody,
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

    it('Venta forbids replacementPrice (a sold item is consumed — nothing to replace)', () => {
      expect(errorPaths({ ...validSell(), replacementPrice: '900' })).toContain('replacementPrice');
      // Absent/empty on Venta is fine — the rule only bites a PRESENT value.
      expect(createProductSchema.safeParse({ ...validSell(), replacementPrice: undefined }).success).toBe(true);
      // Alquiler keeps it optional — present or absent are both fine.
      expect(createProductSchema.safeParse(validRent()).success).toBe(true);
      expect(createProductSchema.safeParse({ ...validRent(), replacementPrice: '' }).success).toBe(true);
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

  describe('one detail per type (mirrors the backend rule)', () => {
    it('rejects two details sharing a detailTypeId, flagging the LATER row', () => {
      const paths = errorPaths({
        ...validRent(),
        details: [
          { detailTypeId: 1, detail: 'Blanco nieve' },
          { detailTypeId: 1, detail: 'Negro mate ok' },
        ],
      });
      expect(paths).toContain('details.1.detailTypeId');
      expect(paths).not.toContain('details.0.detailTypeId');
    });

    it('accepts distinct types and ignores rows still on the placeholder', () => {
      expect(
        errorPaths({
          ...validRent(),
          details: [
            { detailTypeId: 1, detail: 'Blanco nieve' },
            { detailTypeId: 2, detail: 'Madera clara' },
          ],
        }),
      ).toHaveLength(0);
      // Two untouched placeholder rows (null sentinel) fail the REQUIRED rule, but are never
      // flagged as "duplicates" of each other.
      const result = createProductSchema.safeParse({
        ...validRent(),
        details: [
          { detailTypeId: null as never, detail: 'Blanco nieve' },
          { detailTypeId: null as never, detail: 'Negro mate ok' },
        ],
      });
      expect(result.success).toBe(false);
      const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
      expect(messages).not.toContain('modules.panel.products.create.errors.duplicateDetailType');
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

    // Alquiler WITHOUT a replacement price: the key stays absent (it is optional there) —
    // empty string and fully absent both map the same way.
    const rentNoReplacement = toCreateProductBody({ ...validRent(), replacementPrice: '' });
    expect(rentNoReplacement).not.toHaveProperty('replacementPrice');
    const rentAbsentReplacement = toCreateProductBody({ ...validRent(), replacementPrice: undefined });
    expect(rentAbsentReplacement).not.toHaveProperty('replacementPrice');

    const nullUnit = toCreateProductBody({ ...validRent(), rentTimeUnitId: null as never });
    expect(nullUnit.rentTimeUnitId).toBeUndefined();
  });
});

describe('toUpdateProductBody', () => {
  it('keeps detail row ids (kept rows update in place; id-less rows create)', () => {
    const body = toUpdateProductBody({
      ...validRent(),
      details: [
        { id: 12, detailTypeId: 1, detail: '  Blanco nieve  ' },
        { detailTypeId: 2, detail: 'Madera de pino' },
      ],
    });

    expect(body.productDetails).toEqual([
      { id: 12, detailTypeId: 1, detail: 'Blanco nieve' },
      { detailTypeId: 2, detail: 'Madera de pino' },
    ]);
    expect(body.productDetails[1]).not.toHaveProperty('id');
    // The gallery is assembled by the FORM (kept ids + uploaded keys) — the mapper leaves it empty.
    expect(body.images).toEqual([]);
  });

  it('maps the scalars exactly like the create body (conditional pricing included)', () => {
    const rent = toUpdateProductBody(validRent());
    expect(rent).toMatchObject({ rentPrice: 75, rentTimeUnitId: 2, replacementPrice: 900 });
    expect(rent).not.toHaveProperty('sellPrice');

    const sell = toUpdateProductBody(validSell());
    expect(sell).toMatchObject({ sellPrice: 12.5 });
    expect(sell.rentPrice).toBeUndefined();
  });
});

describe('productToFormValues', () => {
  const adminRentProduct = {
    name: 'Mesa redonda',
    description: 'Mesa para 8 personas',
    businessTypeId: BUSINESS_TYPE_RENT,
    categoryId: 3,
    currency: { id: 1 },
    rentPrice: 75,
    rentTimeUnitId: 2,
    replacementPrice: 900,
    available: 35,
    total: 40,
    details: [{ id: 12, detailTypeId: 1, detail: 'Blanco' }],
  };

  it('prefills an Alquiler product — the recorded quantity is the fleet TOTAL', () => {
    expect(productToFormValues(adminRentProduct)).toEqual({
      name: 'Mesa redonda',
      description: 'Mesa para 8 personas',
      businessTypeId: BUSINESS_TYPE_RENT,
      categoryId: 3,
      currencyId: 1,
      quantity: '40',
      rentPrice: '75',
      rentTimeUnitId: 2,
      replacementPrice: '900',
      sellPrice: '',
      details: [{ id: 12, detailTypeId: 1, detail: 'Blanco' }],
    });
  });

  it('prefills a Venta product — the recorded quantity IS `available` (no fleet total)', () => {
    const values = productToFormValues({
      name: 'Vasos',
      businessTypeId: BUSINESS_TYPE_SELL,
      categoryId: 2,
      currency: { id: 1 },
      sellPrice: 12.5,
      available: 100,
      details: [],
    });

    expect(values).toMatchObject({
      quantity: '100',
      sellPrice: '12.5',
      rentPrice: '',
      replacementPrice: '',
      rentTimeUnitId: null,
      description: '',
    });
  });

  it('falls back to 0 when the projection carries no quantity field at all', () => {
    expect(
      productToFormValues({
        name: 'Vasos',
        businessTypeId: BUSINESS_TYPE_SELL,
        categoryId: 2,
        currency: { id: 1 },
        details: [],
      }).quantity,
    ).toBe('0');
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
