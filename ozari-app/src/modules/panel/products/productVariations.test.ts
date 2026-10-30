import { describe, expect, it } from 'vitest';
import type { Product, ProductImage, ProductVariant } from './product.types';
import {
  addValueCombinations,
  allValueKeys,
  combinationOf,
  defaultVariant,
  dropOptionFromVariants,
  dropValueFromVariants,
  effectiveFormValue,
  effectivePricing,
  emptyVariantRow,
  generateCombinations,
  hasVariants,
  lineDisplayName,
  matchVariant,
  mintValueKey,
  normalizeVariationName,
  orderedValueKeys,
  photoSetFor,
  picksForVariant,
  stockKey,
  valueKeyForId,
  variantFor,
  variantLabelFor,
  variantMatchesPicks,
  variantPriceRange,
  variantRowIssues,
  type OptionFormRow,
  type VariantFormRow,
  type VariantRowContext,
} from './productVariations';

const img = (id: number, isPrimary = false): ProductImage => ({
  id,
  url: `https://cdn/${id}.webp`,
  isPrimary,
  sortOrder: id,
});

const colorSize: OptionFormRow[] = [
  { name: 'Color', values: [{ key: 'r', name: 'Rojo' }, { key: 'a', name: 'Azul' }] },
  { name: 'Tamaño', values: [{ key: 'red', name: 'Redondo' }] },
];

const row = (valueKeys: string[], patch: Partial<VariantFormRow> = {}): VariantFormRow => ({
  ...emptyVariantRow(valueKeys),
  ...patch,
});

const variant = (patch: Partial<ProductVariant> & { id: number; valueIds: number[] }): ProductVariant => ({
  label: '',
  isDefault: false,
  ...patch,
});

/** Color (1 Rojo [photos], 2 Azul [none]) × Tamaño (3 Redondo [photos]). */
const product = (patch: Partial<Product> = {}): Product => ({
  id: 9,
  name: 'Mantel',
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Mantelería',
  categoryId: 1,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 50,
  securityDeposit: 20,
  replacementPrice: 100,
  description: 'Mantel de tela',
  images: [img(1), img(2, true)],
  details: [],
  options: [
    {
      id: 10,
      name: 'Color',
      sortOrder: 0,
      values: [
        { id: 1, name: 'Rojo', sortOrder: 0, images: [img(11)] },
        { id: 2, name: 'Azul', sortOrder: 1, images: [] },
      ],
    },
    {
      id: 20,
      name: 'Tamaño',
      sortOrder: 1,
      values: [{ id: 3, name: 'Redondo', sortOrder: 0, images: [img(33)] }],
    },
  ],
  variants: [
    variant({ id: 100, valueIds: [1, 3], label: 'Rojo · Redondo', rentPrice: 50, securityDeposit: 0 }),
    variant({ id: 200, valueIds: [3, 2], label: 'Azul · Redondo', rentPrice: 70, isDefault: true }),
  ],
  ...patch,
});

describe('lineDisplayName', () => {
  it('joins the product and the variation with the one line separator', () => {
    expect(lineDisplayName({ productName: 'Mantel', variantLabel: 'Rojo · Redondo' })).toBe(
      'Mantel — Rojo · Redondo',
    );
  });

  it('keeps the bare product name without a variation (or a blank one)', () => {
    expect(lineDisplayName({ productName: 'Silla' })).toBe('Silla');
    expect(lineDisplayName({ productName: 'Silla', variantLabel: null })).toBe('Silla');
    expect(lineDisplayName({ productName: 'Silla', variantLabel: '  ' })).toBe('Silla');
  });
});

describe('names and keys', () => {
  it('normalizes case, accents and spacing', () => {
    expect(normalizeVariationName('  Rójo   Vino ')).toBe('rojo vino');
  });

  it('mints keys that skip taken ones and saved-value keys from ids', () => {
    const first = mintValueKey([]);
    expect(first).toMatch(/^n\d+$/);
    const next = mintValueKey([first, `n${Number(first.slice(1)) + 1}`]);
    expect(next).toBe(`n${Number(first.slice(1)) + 2}`);
    expect(valueKeyForId(12)).toBe('v12');
    expect(allValueKeys(colorSize)).toEqual(['r', 'a', 'red']);
  });

  it('treats a combination as a set', () => {
    expect(combinationOf(['b', 'a'])).toBe(combinationOf(['a', 'b']));
  });
});

describe('combinations', () => {
  it('generates every combination in option order', () => {
    expect(generateCombinations(colorSize)).toEqual([
      ['r', 'red'],
      ['a', 'red'],
    ]);
  });

  it('is empty without options or when an option has no value yet', () => {
    expect(generateCombinations([])).toEqual([]);
    expect(generateCombinations([...colorSize, { name: 'Tela', values: [] }])).toEqual([]);
  });

  it('orders and labels keys by option, dropping unknown ones', () => {
    expect(orderedValueKeys(colorSize, ['red', 'x', 'a'])).toEqual(['a', 'red']);
    expect(variantLabelFor(colorSize, ['red', 'a'])).toBe('Azul · Redondo');
  });

  it("completes every variation with an option's FIRST value", () => {
    const options: OptionFormRow[] = [
      colorSize[0],
      { name: 'Tamaño', values: [{ key: 'red', name: 'Redondo' }] },
    ];
    const next = addValueCombinations(options, [row(['r'], { id: 5, quantity: '3' })], 1, 'red');
    expect(next).toEqual([row(['r', 'red'], { id: 5, quantity: '3' })]);
  });

  it('offers the new combinations a further value creates, up to the cap', () => {
    const options: OptionFormRow[] = [
      { name: 'Color', values: [{ key: 'r', name: 'Rojo' }, { key: 'a', name: 'Azul' }, { key: 'v', name: 'Verde' }] },
      { name: 'Tamaño', values: [{ key: 'red', name: 'Redondo' }, { key: 'cu', name: 'Cuadrado' }] },
    ];
    const existing = [row(['r', 'red']), row(['a', 'red']), row(['r', 'cu'])];
    expect(addValueCombinations(options, existing, 1, 'cu').map((v) => v.valueKeys)).toEqual([
      ['r', 'red'],
      ['a', 'red'],
      ['r', 'cu'],
      ['a', 'cu'],
      ['v', 'cu'],
    ]);
    expect(addValueCombinations(options, existing, 1, 'cu', 4)).toHaveLength(4);
  });

  it("offers a product's very first value (nothing offered yet), ignoring options still empty", () => {
    const options: OptionFormRow[] = [
      { name: 'Color', values: [{ key: 'r', name: 'Rojo' }] },
      { name: 'Tamaño', values: [] },
    ];
    expect(addValueCombinations(options, [], 0, 'r').map((v) => v.valueKeys)).toEqual([['r']]);
    // A further value while the other option is still empty offers its own combination too.
    const two: OptionFormRow[] = [
      { name: 'Color', values: [{ key: 'r', name: 'Rojo' }, { key: 'a', name: 'Azul' }] },
      { name: 'Tamaño', values: [] },
    ];
    expect(addValueCombinations(two, [row(['r'])], 0, 'a').map((v) => v.valueKeys)).toEqual([
      ['r'],
      ['a'],
    ]);
  });

  it('drops the variations of a removed value', () => {
    expect(dropValueFromVariants([row(['r', 'red']), row(['a', 'red'])], 'r')).toEqual([
      row(['a', 'red']),
    ]);
  });

  it('collapses variations onto the remaining options, the first keeping its row', () => {
    const variants = [row(['r', 'red'], { id: 1 }), row(['r', 'cu'], { id: 2 }), row(['a', 'cu'], { id: 3 })];
    expect(dropOptionFromVariants(variants, ['red', 'cu'])).toEqual([
      row(['r'], { id: 1 }),
      row(['a'], { id: 3 }),
    ]);
    expect(dropOptionFromVariants([row(['r'])], ['r', 'a'])).toEqual([]);
  });
});

describe('variantRowIssues', () => {
  const parseMoney = (value: string): number | undefined | null => {
    if (value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const context = (patch: Partial<VariantRowContext> = {}): VariantRowContext => ({
    isRent: true,
    productReplacementPrice: '100',
    productSecurityDeposit: '20',
    parseMoney,
    parseQuantity: (value) => (/^\d+$/.test(value) ? Number(value) : null),
    isValidDescription: (value) => value.length >= 5,
    ...patch,
  });

  it('passes a clean row', () => {
    expect(variantRowIssues(row(['r'], { quantity: '4', rentPrice: '60' }), context())).toEqual([]);
  });

  it('flags the stock, unparseable money and a short description', () => {
    expect(
      variantRowIssues(row(['r'], { quantity: '', rentPrice: 'x', description: 'abc' }), context()),
    ).toEqual([
      { field: 'quantity', issue: 'invalidVariantQuantity' },
      { field: 'rentPrice', issue: 'invalidRentPrice' },
      { field: 'description', issue: 'invalidDescription' },
    ]);
  });

  it('refuses overrides of the other business type', () => {
    expect(variantRowIssues(row(['r'], { quantity: '1', sellPrice: '5' }), context())).toEqual([
      { field: 'sellPrice', issue: 'variantPricingMismatch' },
    ]);
    expect(
      variantRowIssues(
        row(['r'], { quantity: '1', rentPrice: '5', replacementPrice: '5', securityDeposit: '1' }),
        context({ isRent: false }),
      ).map((issue) => issue.field),
    ).toEqual(['rentPrice', 'replacementPrice', 'securityDeposit']);
  });

  it('compares the EFFECTIVE deposit and replacement', () => {
    // An inherited replacement (100) under an overridden deposit (150).
    expect(variantRowIssues(row(['r'], { quantity: '1', securityDeposit: '150' }), context())).toEqual([
      { field: 'securityDeposit', issue: 'securityDepositAboveReplacement' },
    ]);
    // An overridden replacement (10) under the inherited deposit (20).
    expect(variantRowIssues(row(['r'], { quantity: '1', replacementPrice: '10' }), context())).toEqual([
      { field: 'securityDeposit', issue: 'securityDepositAboveReplacement' },
    ]);
    // 0 = explicitly no deposit, and nothing to compare without a replacement.
    expect(
      variantRowIssues(row(['r'], { quantity: '1', replacementPrice: '10', securityDeposit: '0' }), context()),
    ).toEqual([]);
    expect(
      variantRowIssues(row(['r'], { quantity: '1' }), context({ productReplacementPrice: '' })),
    ).toEqual([]);
  });

  it('shows the override when typed, else the inherited value', () => {
    expect(effectiveFormValue(' ', '20')).toBe('20');
    expect(effectiveFormValue('5', '20')).toBe('5');
  });
});

describe('the saved product', () => {
  it('finds variations and the default', () => {
    const subject = product();
    expect(hasVariants(subject)).toBe(true);
    expect(hasVariants({ variants: undefined })).toBe(false);
    expect(variantFor(subject, 200)?.label).toBe('Azul · Redondo');
    expect(variantFor(subject, null)).toBeUndefined();
    expect(variantFor({ variants: undefined }, 1)).toBeUndefined();
    expect(defaultVariant(subject)?.id).toBe(200);
    expect(defaultVariant({ variants: [variant({ id: 1, valueIds: [] })] })?.id).toBe(1);
    expect(defaultVariant({ variants: undefined })).toBeUndefined();
  });

  it("takes a variation's effective values as they are — a 0 deposit never falls back", () => {
    const subject = product();
    expect(effectivePricing(subject, subject.variants?.[0])).toEqual({
      rentPrice: 50,
      sellPrice: undefined,
      securityDeposit: 0,
      replacementPrice: undefined,
      description: undefined,
    });
    expect(effectivePricing(subject).securityDeposit).toBe(20);
  });

  it('reports the price range for rent and sale', () => {
    expect(variantPriceRange(product())).toEqual({ min: 50, max: 70 });
    expect(
      variantPriceRange({
        variants: [variant({ id: 1, valueIds: [], sellPrice: 9 }), variant({ id: 2, valueIds: [] })],
      }),
    ).toEqual({ min: 9, max: 9 });
    expect(variantPriceRange({ variants: undefined })).toBeNull();
  });

  it('keys stock per pair', () => {
    expect(stockKey(4)).toBe('4:');
    expect(stockKey(4, null)).toBe('4:');
    expect(stockKey(4, 7)).toBe('4:7');
  });

  it('maps a variation to per-option picks and back', () => {
    const subject = product();
    const azul = subject.variants![1];
    expect(picksForVariant(subject, azul)).toEqual([2, 3]);
    expect(picksForVariant({ options: undefined }, azul)).toEqual([]);
    expect(picksForVariant(subject, variant({ id: 1, valueIds: [99] }))).toEqual([null, null]);
    expect(matchVariant(subject, [2, 3])?.id).toBe(200);
    expect(matchVariant(subject, [2, null])).toBeUndefined();
    expect(matchVariant(subject, [2])).toBeUndefined();
    expect(matchVariant({ options: undefined, variants: undefined }, [])).toBeUndefined();
    expect(matchVariant({ ...subject, variants: undefined }, [2, 3])).toBeUndefined();
    expect(variantMatchesPicks(subject, azul, [2, null])).toBe(true);
    expect(variantMatchesPicks(subject, azul, [1, null])).toBe(false);
  });
});

describe('photoSetFor', () => {
  it("shows the first picked value WITH photos, in option order", () => {
    const subject = product();
    expect(photoSetFor(subject, [1, 3]).map((i) => i.id)).toEqual([11]);
    // Azul has none → the next option's value.
    expect(photoSetFor(subject, [2, 3]).map((i) => i.id)).toEqual([33]);
  });

  it('falls back to the showcase', () => {
    const subject = product();
    expect(photoSetFor(subject, [null, null]).map((i) => i.id)).toEqual([1, 2]);
    expect(photoSetFor({ ...subject, options: undefined }, []).map((i) => i.id)).toEqual([1, 2]);
    // A pick without photos anywhere keeps the (empty) showcase rather than the default's photos.
    const bare = product({ images: [] });
    bare.options![1].values[0].images = [];
    expect(photoSetFor(bare, [2, null])).toEqual([]);
  });

  it("opens on the DEFAULT variation's photos when there is no showcase", () => {
    expect(photoSetFor(product({ images: [] }), []).map((i) => i.id)).toEqual([33]);
    expect(photoSetFor(product({ images: [], variants: [] }), [])).toEqual([]);
    const bare = product({ images: [] });
    bare.options![1].values[0].images = [];
    expect(photoSetFor(bare, [])).toEqual([]);
  });
});
