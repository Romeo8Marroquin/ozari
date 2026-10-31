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
  sharedStock: false,
  rentPrice: '75',
  rentTimeUnitId: 2,
  replacementPrice: '900',
  sellPrice: '',
  details: [{ detailTypeId: 1, detail: 'Blanco nieve' }],
  options: [],
  variants: [],
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

    describe('the security deposit (mirrors the backend deposit rules)', () => {
      it('is optional money within [0, 1,000,000] on Alquiler', () => {
        expect(createProductSchema.safeParse({ ...validRent(), securityDeposit: '' }).success).toBe(true);
        expect(createProductSchema.safeParse({ ...validRent(), securityDeposit: undefined }).success).toBe(true);
        expect(createProductSchema.safeParse({ ...validRent(), securityDeposit: '0' }).success).toBe(true);
        expect(createProductSchema.safeParse({ ...validRent(), securityDeposit: '150.5' }).success).toBe(true);
        expect(errorPaths({ ...validRent(), securityDeposit: 'abc' })).toContain('securityDeposit');
        expect(errorPaths({ ...validRent(), securityDeposit: '-1' })).toContain('securityDeposit');
        expect(
          errorPaths({ ...validRent(), replacementPrice: '', securityDeposit: '1000001' }),
        ).toContain('securityDeposit');
      });

      it('may not exceed the replacement price (equal is fine; compared on cents)', () => {
        expect(errorPaths({ ...validRent(), securityDeposit: '900.01' })).toContain('securityDeposit');
        expect(createProductSchema.safeParse({ ...validRent(), securityDeposit: '900' }).success).toBe(true);
        // The API truncates to cents before comparing, so a third decimal never tips it over.
        expect(createProductSchema.safeParse({ ...validRent(), securityDeposit: '900.009' }).success).toBe(
          true,
        );
        // Without a replacement price (empty OR absent) there is no ceiling but the global one.
        expect(
          createProductSchema.safeParse({ ...validRent(), replacementPrice: '', securityDeposit: '5000' }).success,
        ).toBe(true);
        expect(
          createProductSchema.safeParse({ ...validRent(), replacementPrice: undefined, securityDeposit: '5000' })
            .success,
        ).toBe(true);
        // An INVALID replacement reports on its own field only — no bogus cross-field issue.
        const paths = errorPaths({ ...validRent(), replacementPrice: 'abc', securityDeposit: '5' });
        expect(paths).toContain('replacementPrice');
        expect(paths).not.toContain('securityDeposit');
      });

      it('is forbidden on Venta (nothing comes back from a sale)', () => {
        expect(errorPaths({ ...validSell(), securityDeposit: '50' })).toContain('securityDeposit');
        expect(createProductSchema.safeParse({ ...validSell(), securityDeposit: '' }).success).toBe(true);
        expect(createProductSchema.safeParse({ ...validSell(), securityDeposit: undefined }).success).toBe(true);
      });
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

  it('sends the security deposit (truncated to cents) for Alquiler only, omitted when empty', () => {
    expect(toCreateProductBody({ ...validRent(), securityDeposit: '150.559' }).securityDeposit).toBe(150.55);
    expect(toCreateProductBody({ ...validRent(), securityDeposit: '' })).not.toHaveProperty('securityDeposit');
    expect(toCreateProductBody({ ...validRent(), securityDeposit: undefined })).not.toHaveProperty(
      'securityDeposit',
    );
    expect(toCreateProductBody({ ...validSell(), securityDeposit: '50' })).not.toHaveProperty('securityDeposit');
    expect(toUpdateProductBody({ ...validRent(), securityDeposit: '150' }).securityDeposit).toBe(150);
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
      sharedStock: false,
      rentPrice: '75',
      rentTimeUnitId: 2,
      replacementPrice: '900',
      securityDeposit: '',
      sellPrice: '',
      details: [{ id: 12, detailTypeId: 1, detail: 'Blanco' }],
      options: [],
      variants: [],
    });
  });

  it('prefills options in sortOrder under `v<id>` keys and variations from their RAW overrides', () => {
    const values = productToFormValues({
      ...adminRentProduct,
      options: [
        {
          id: 2,
          name: 'Tamaño',
          sortOrder: 1,
          kind: 'generic' as const,
          values: [{ id: 7, name: 'Redondo', sortOrder: 0, images: [] }],
        },
        {
          id: 1,
          name: 'Color',
          sortOrder: 0,
          kind: 'generic' as const,
          values: [
            { id: 5, name: 'Azul', sortOrder: 1, images: [] },
            { id: 4, name: 'Rojo', sortOrder: 0, images: [] },
          ],
        },
      ],
      variants: [
        {
          id: 50,
          valueIds: [4, 7],
          label: 'Rojo · Redondo',
          isDefault: true,
          rentPrice: 75,
          quantity: 6,
          overrides: { securityDeposit: 0, description: 'Rojo intenso' },
        },
        { id: 51, valueIds: [5, 7], label: 'Azul · Redondo', isDefault: false, total: 3 },
        { id: 52, valueIds: [5], label: 'x', isDefault: false, available: 2 },
        { id: 53, valueIds: [4], label: 'y', isDefault: false },
      ],
    });
    expect(values.options).toEqual([
      { id: 1, name: 'Color', kind: 'generic', values: [{ id: 4, key: 'v4', name: 'Rojo', color: '' }, { id: 5, key: 'v5', name: 'Azul', color: '' }] },
      { id: 2, name: 'Tamaño', kind: 'generic', values: [{ id: 7, key: 'v7', name: 'Redondo', color: '' }] },
    ]);
    expect(values.variants[0]).toEqual({
      id: 50,
      valueKeys: ['v4', 'v7'],
      quantity: '6',
      rentPrice: '',
      sellPrice: '',
      replacementPrice: '',
      securityDeposit: '0',
      description: 'Rojo intenso',
      isDefault: true,
    });
    expect(values.variants.map((variant) => variant.quantity)).toEqual(['6', '3', '2', '0']);
  });

  it('ignores stray variations when the product declares no options', () => {
    expect(
      productToFormValues({
        ...adminRentProduct,
        variants: [{ id: 1, valueIds: [], label: '', isDefault: true }],
      }).variants,
    ).toEqual([]);
  });

  it('prefills the security deposit so a full-state edit sends it back (never erases it)', () => {
    expect(productToFormValues({ ...adminRentProduct, securityDeposit: 150 }).securityDeposit).toBe('150');
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

  it('never marks a variation override as required', () => {
    const matches = (name: string) =>
      createProductRequiredPatterns.some((pattern) => pattern.test(name));
    expect(matches('variants.0.quantity')).toBe(true);
    expect(matches('options.0.name')).toBe(true);
    expect(matches('variants.0.rentPrice')).toBe(false);
    expect(matches('variants.0.description')).toBe(false);
  });

  it('exposes pristine defaults (Alquiler, Día, GTQ, no details)', () => {
    expect(createProductDefaultValues.businessTypeId).toBe(BUSINESS_TYPE_RENT);
    expect(createProductDefaultValues.rentTimeUnitId).toBe(2);
    expect(createProductDefaultValues.currencyId).toBe(1);
    expect(createProductDefaultValues.details).toEqual([]);
  });
});

describe('variations (mirrors the API parseProductVariations)', () => {
  const variantRow = (valueKeys: string[], patch: Partial<CreateProductFormType['variants'][number]> = {}) => ({
    valueKeys,
    quantity: '5',
    rentPrice: '',
    sellPrice: '',
    replacementPrice: '',
    securityDeposit: '',
    description: '',
    isDefault: false,
    ...patch,
  });
  const withVariations = (patch: Partial<CreateProductFormType> = {}): CreateProductFormType => ({
    ...validRent(),
    quantity: '',
    options: [
      { name: 'Color', kind: 'generic', values: [{ key: 'r', name: 'Rojo', color: '' }, { key: 'a', name: 'Azul', color: '' }] },
      { name: 'Tamaño', kind: 'generic', values: [{ key: 't', name: 'Redondo', color: '' }] },
    ],
    variants: [variantRow(['r', 't'], { isDefault: true }), variantRow(['a', 't'], { rentPrice: '60' })],
    ...patch,
  });

  it('accepts options + variations and no longer needs the product quantity', () => {
    expect(errorPaths(withVariations())).toEqual([]);
    expect(errorPaths({ ...validRent(), quantity: '' })).toEqual(['quantity']);
  });

  const savedMantel = {
    name: 'Mantel',
    businessTypeId: BUSINESS_TYPE_RENT,
    categoryId: 1,
    currency: { id: 1 },
    details: [],
  };

  it('makes the general price an optional default — each variation needs one from somewhere', () => {
    // Rojo inherits the general 75, Azul carries its own 60: fine either way.
    expect(errorPaths(withVariations())).toEqual([]);
    // No general price: Azul still has its own, Rojo has nothing to inherit.
    expect(errorPaths(withVariations({ rentPrice: '' }))).toEqual(['variants.0.rentPrice']);
    // Venta mirrors it on the sell price.
    expect(
      errorPaths(
        withVariations({
          businessTypeId: BUSINESS_TYPE_SELL,
          rentPrice: '',
          rentTimeUnitId: undefined,
          replacementPrice: '',
          sellPrice: undefined,
          variants: [variantRow(['r', 't'], { sellPrice: '9' }), variantRow(['a', 't'])],
        }),
      ),
    ).toEqual(['variants.1.sellPrice']);
    // A blank general price simply rides absent.
    expect(toCreateProductBody(withVariations({ rentPrice: '' })).rentPrice).toBeUndefined();
  });

  it('moves the stock to the product with a SHARED stock — rows carry none', () => {
    const shared = withVariations({ sharedStock: true, variants: [variantRow(['r', 't'], { quantity: '' })] });
    expect(errorPaths(shared)).toEqual(['quantity']);
    const body = toCreateProductBody({ ...shared, quantity: '3' });
    expect(body).toMatchObject({ quantity: 3, sharedStock: true });
    expect(body.variants).toEqual([{ valueKeys: ['r', 't'] }]);
    // Ignored without options: no flag, the product's own quantity as always.
    expect(toCreateProductBody({ ...validRent(), sharedStock: true }).sharedStock).toBeUndefined();
    expect(
      productToFormValues({ ...savedMantel, sharedStock: true, options: [] }).sharedStock,
    ).toBe(false);
  });

  it('carries a COLOR option: one per product, each value a real colour, sent lowercased', () => {
    const color = (values: { key: string; name: string; color: string }[]) => ({
      name: 'Color',
      kind: 'color' as const,
      values,
    });
    const data = withVariations({
      options: [
        color([
          { key: 'r', name: 'Marfil', color: '#FFFFF0' },
          { key: 'a', name: 'Azul', color: '' },
        ]),
        { name: 'Tamaño', kind: 'color', values: [{ key: 't', name: 'Redondo', color: '#000000' }] },
      ],
    });
    expect(errorPaths(data)).toEqual(['options.0.values.1.color', 'options.1.kind']);
    const body = toCreateProductBody(
      withVariations({
        options: [
          color([
            { key: 'r', name: 'Marfil', color: '#FFFFF0' },
            { key: 'a', name: 'Azul', color: '#0000ff' },
          ]),
          // A generic option keeps a colour in the form but never sends it.
          { name: 'Tamaño', kind: 'generic', values: [{ key: 't', name: 'Redondo', color: '#123456' }] },
        ],
      }),
    );
    expect(body.options).toEqual([
      {
        name: 'Color',
        kind: 'color',
        values: [
          { key: 'r', name: 'Marfil', color: '#fffff0', images: [] },
          { key: 'a', name: 'Azul', color: '#0000ff', images: [] },
        ],
      },
      { name: 'Tamaño', values: [{ key: 't', name: 'Redondo', images: [] }] },
    ]);
    // The edit form reads kind + colour back (a generic value reads as no colour).
    expect(
      productToFormValues({
        ...savedMantel,
        options: [
          {
            id: 1,
            name: 'Color',
            sortOrder: 0,
            kind: 'color',
            values: [
              { id: 4, name: 'Marfil', sortOrder: 0, images: [], color: '#fffff0' },
              { id: 5, name: 'Sin', sortOrder: 1, images: [] },
            ],
          },
        ],
      }).options,
    ).toEqual([
      {
        id: 1,
        name: 'Color',
        kind: 'color',
        values: [
          { id: 4, key: 'v4', name: 'Marfil', color: '#fffff0' },
          { id: 5, key: 'v5', name: 'Sin', color: '' },
        ],
      },
    ]);
  });

  it('tolerates ABSENT product deposit/replacement strings', () => {
    expect(errorPaths(withVariations({ securityDeposit: undefined, replacementPrice: undefined }))).toEqual([]);
    expect(
      productToFormValues({
        name: 'Mantel',
        businessTypeId: BUSINESS_TYPE_RENT,
        categoryId: 1,
        currency: { id: 1 },
        details: [],
        options: [{ id: 1, name: 'Color', sortOrder: 0, kind: 'generic' as const, values: [] }],
      }).variants,
    ).toEqual([]);
  });

  it('caps options, values and variations', () => {
    const value = (index: number) => ({ key: `k${index}`, name: `Valor ${index}`, color: '' });
    const option = (name: string, count: number, offset: number) => ({
      name,
      kind: 'generic' as const,
      values: Array.from({ length: count }, (_, i) => value(offset + i)),
    });
    expect(
      errorPaths(withVariations({ options: [option('Uno', 1, 0), option('Dos', 1, 1), option('Tres', 1, 2), option('Cuatro', 1, 3)], variants: [] })),
    ).toEqual(expect.arrayContaining(['options', 'variants']));
    expect(errorPaths(withVariations({ options: [option('Uno', 21, 0)], variants: [variantRow(['k0'])] }))).toEqual([
      'options.0.values',
    ]);
    const many = option('Uno', 20, 0);
    const many2 = option('Dos', 4, 100);
    const variants = many.values.flatMap((a) => many2.values.map((b) => variantRow([a.key, b.key])));
    expect(errorPaths(withVariations({ options: [many, many2], variants }))).toEqual(['variants']);
  });

  it('checks names: alphabet, length and case/accent-insensitive uniqueness', () => {
    expect(
      errorPaths(
        withVariations({
          options: [
            { name: 'Color!', kind: 'generic', values: [{ key: 'r', name: 'Rojo', color: '' }, { key: 'a', name: ' rójo ', color: '' }] },
            { name: '', kind: 'generic', values: [{ key: 't', name: 'x'.repeat(41), color: '' }] },
          ],
        }),
      ),
    ).toEqual(['options.0.name', 'options.0.values.1.name', 'options.1.name', 'options.1.values.0.name']);
    expect(
      errorPaths(
        withVariations({
          options: [
            { name: 'Color', kind: 'generic', values: [{ key: 'r', name: 'Rojo', color: '' }] },
            { name: 'COLÓR', kind: 'generic', values: [{ key: 't', name: 'Redondo', color: '' }] },
          ],
          variants: [variantRow(['r', 't'])],
        }),
      ),
    ).toEqual(['options.1.name']);
  });

  it('requires a value per option and well-formed unique keys', () => {
    expect(
      errorPaths(withVariations({ options: [{ name: 'Color', kind: 'generic', values: [] }], variants: [variantRow([])] })),
    ).toEqual(expect.arrayContaining(['options.0.values', 'variants.0.valueKeys']));
    expect(
      errorPaths(
        withVariations({
          options: [{ name: 'Color', kind: 'generic', values: [{ key: 'bad key', name: 'Rojo', color: '' }, { key: 'bad key', name: 'Azul', color: '' }] }],
          variants: [variantRow(['bad key'])],
        }),
      ),
    ).toEqual(['options.0.values.0.key', 'options.0.values.1.key']);
  });

  it('requires variations with options and forbids them without', () => {
    expect(errorPaths(withVariations({ variants: [] }))).toEqual(['variants']);
    expect(errorPaths({ ...validRent(), variants: [variantRow([])] })).toEqual(['variants']);
  });

  it('refuses malformed or repeated combinations and a second default', () => {
    expect(
      errorPaths(
        withVariations({
          variants: [
            variantRow(['r', 't'], { isDefault: true }),
            variantRow(['t', 'r'], { isDefault: true }),
            variantRow(['r']),
            variantRow(['r', 'zz']),
            variantRow(['r', 'a']),
          ],
        }),
      ),
    ).toEqual([
      'variants.1.valueKeys',
      'variants.2.valueKeys',
      'variants.3.valueKeys',
      'variants.4.valueKeys',
      'variants',
    ]);
  });

  it('applies the per-row rules on the EFFECTIVE values', () => {
    expect(
      errorPaths(
        withVariations({
          variants: [
            variantRow(['r', 't'], { quantity: '', sellPrice: '3', securityDeposit: '1000' }),
            variantRow(['a', 't'], { description: 'ab' }),
          ],
        }),
      ),
    ).toEqual([
      'variants.0.quantity',
      'variants.0.sellPrice',
      'variants.0.securityDeposit',
      'variants.1.description',
    ]);
    // Venta: only the sell price may be overridden.
    expect(
      errorPaths({
        ...validSell(),
        quantity: '',
        options: [{ name: 'Color', kind: 'generic', values: [{ key: 'r', name: 'Rojo', color: '' }] }],
        variants: [variantRow(['r'], { sellPrice: '9', rentPrice: '2' })],
      }),
    ).toEqual(['variants.0.rentPrice']);
  });

  const rentBody = () =>
    toCreateProductBody(
      withVariations({
        variants: [
          variantRow(['r', 't'], {
            isDefault: true,
            rentPrice: '60.129',
            replacementPrice: '500',
            securityDeposit: '0',
            description: '  Rojo intenso ',
          }),
          variantRow(['a', 't'], { sellPrice: '4' }),
        ],
      }),
      { r: [{ key: 'products/r.jpg', isPrimary: true }] },
    );

  it('maps a create body: no product quantity, options with value photos, typed overrides only', () => {
    const body = rentBody();
    expect(body.quantity).toBeUndefined();
    expect(body.options).toEqual([
      {
        name: 'Color',
        values: [
          { key: 'r', name: 'Rojo', images: [{ key: 'products/r.jpg', isPrimary: true }] },
          { key: 'a', name: 'Azul', images: [] },
        ],
      },
      { name: 'Tamaño', values: [{ key: 't', name: 'Redondo', images: [] }] },
    ]);
    expect(body.variants).toEqual([
      {
        valueKeys: ['r', 't'],
        quantity: 5,
        rentPrice: 60.12,
        replacementPrice: 500,
        securityDeposit: 0,
        description: 'Rojo intenso',
        isDefault: true,
      },
      // A stray sell override never rides a rental body.
      { valueKeys: ['a', 't'], quantity: 5 },
    ]);
    expect(toCreateProductBody(validRent()).options).toBeUndefined();
  });

  it('maps a Venta variation to the sell override only', () => {
    const body = toCreateProductBody({
      ...validSell(),
      options: [{ name: 'Color', kind: 'generic', values: [{ key: 'r', name: 'Rojo', color: '' }] }],
      variants: [variantRow(['r'], { sellPrice: '9', rentPrice: '2' })],
    });
    expect(body.variants).toEqual([{ valueKeys: ['r'], quantity: 5, sellPrice: 9 }]);
  });

  it('keeps every saved id on an update (and never on a create)', () => {
    const data = withVariations({
      options: [
        { id: 1, name: 'Color', kind: 'generic', values: [{ id: 4, key: 'v4', name: 'Rojo', color: '' }, { key: 'n1', name: 'Azul', color: '' }] },
      ],
      variants: [variantRow(['v4'], { id: 50, isDefault: true }), variantRow(['n1'])],
    });
    const images = { v4: [{ id: 9, isPrimary: false }, { key: 'products/n.jpg', isPrimary: true }] };
    const update = toUpdateProductBody(data, images);
    expect(update.options).toEqual([
      {
        id: 1,
        name: 'Color',
        values: [
          { id: 4, key: 'v4', name: 'Rojo', images: images.v4 },
          { key: 'n1', name: 'Azul', images: [] },
        ],
      },
    ]);
    expect(update.variants?.map((variant) => variant.id)).toEqual([50, undefined]);
    const create = toCreateProductBody(data, { n1: [{ key: 'products/x.jpg', isPrimary: true }] });
    expect(create.options?.[0]).not.toHaveProperty('id');
    expect(create.options?.[0].values[1].images).toEqual([{ key: 'products/x.jpg', isPrimary: true }]);
    expect(create.variants?.[0]).not.toHaveProperty('id');
  });
});
