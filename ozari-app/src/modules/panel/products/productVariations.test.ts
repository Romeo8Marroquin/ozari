import { describe, expect, it } from 'vitest';
import type { Product, ProductImage, ProductVariant } from './product.types';
import {
  addValueCombinations,
  allValueKeys,
  carryRowKeys,
  combinationOf,
  defaultVariant,
  dropOptionFromVariants,
  dropValueFromVariants,
  effectiveFormValue,
  effectivePricing,
  emptyVariantRow,
  generateCombinations,
  hasVariants,
  isLightColor,
  lineDisplayName,
  matchVariant,
  mintValueKey,
  normalizeVariationName,
  orderedValueKeys,
  photoSetFor,
  pickedLabel,
  picksForVariant,
  poolKeyOf,
  rowKeyOf,
  stockKey,
  valueKeyForId,
  variantFor,
  variantLabelFor,
  variantMatchesPicks,
  variantPriceRange,
  variantRange,
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
  { name: 'Color', kind: 'generic', values: [{ key: 'r', name: 'Rojo', color: '' }, { key: 'a', name: 'Azul', color: '' }] },
  { name: 'Tamaño', kind: 'generic', values: [{ key: 'red', name: 'Redondo', color: '' }] },
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
      kind: 'generic' as const,
      values: [
        { id: 1, name: 'Rojo', sortOrder: 0, images: [img(11)] },
        { id: 2, name: 'Azul', sortOrder: 1, images: [] },
      ],
    },
    {
      id: 20,
      name: 'Tamaño',
      sortOrder: 1,
      kind: 'generic' as const,
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
    expect(generateCombinations([...colorSize, { name: 'Tela', kind: 'generic', values: [] }])).toEqual([]);
  });

  it('orders and labels keys by option, dropping unknown ones', () => {
    expect(orderedValueKeys(colorSize, ['red', 'x', 'a'])).toEqual(['a', 'red']);
    expect(variantLabelFor(colorSize, ['red', 'a'])).toBe('Azul · Redondo');
  });

  it("completes every variation with an option's FIRST value", () => {
    const options: OptionFormRow[] = [
      colorSize[0],
      { name: 'Tamaño', kind: 'generic', values: [{ key: 'red', name: 'Redondo', color: '' }] },
    ];
    const next = addValueCombinations(options, [row(['r'], { id: 5, quantity: '3' })], 1, 'red');
    expect(next).toEqual([row(['r', 'red'], { id: 5, quantity: '3' })]);
  });

  it('offers the new combinations a further value creates, up to the cap', () => {
    const options: OptionFormRow[] = [
      { name: 'Color', kind: 'generic', values: [{ key: 'r', name: 'Rojo', color: '' }, { key: 'a', name: 'Azul', color: '' }, { key: 'v', name: 'Verde', color: '' }] },
      { name: 'Tamaño', kind: 'generic', values: [{ key: 'red', name: 'Redondo', color: '' }, { key: 'cu', name: 'Cuadrado', color: '' }] },
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
      { name: 'Color', kind: 'generic', values: [{ key: 'r', name: 'Rojo', color: '' }] },
      { name: 'Tamaño', kind: 'generic', values: [] },
    ];
    expect(addValueCombinations(options, [], 0, 'r').map((v) => v.valueKeys)).toEqual([['r']]);
    // A further value while the other option is still empty offers its own combination too.
    const two: OptionFormRow[] = [
      { name: 'Color', kind: 'generic', values: [{ key: 'r', name: 'Rojo', color: '' }, { key: 'a', name: 'Azul', color: '' }] },
      { name: 'Tamaño', kind: 'generic', values: [] },
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

describe('row identity (rowKeyOf / carryRowKeys)', () => {
  it('names a row by its given key, else by its own combination', () => {
    expect(rowKeyOf(new Map(), ['b', 'a'])).toBe('a|b');
    expect(rowKeyOf(new Map([['a|b', 'a']]), ['a', 'b'])).toBe('a');
  });

  it("carries rows through an option's first value: same rows, one more value", () => {
    const { rowKeys, leaving } = carryRowKeys([['r'], ['z']], new Map(), (combo) => [...combo, 'g']);
    expect([...rowKeys]).toEqual([
      ['g|r', 'r'],
      ['g|z', 'z'],
    ]);
    expect(leaving).toEqual([]);
  });

  it('merges rows when an option leaves — the first survives — and lets emptied rows go', () => {
    const before = [
      ['r', 'g'],
      ['r', 'c'],
      ['z', 'g'],
    ];
    const merged = carryRowKeys(before, new Map([['g|r', 'r']]), (combo) =>
      combo.filter((key) => key !== 'g' && key !== 'c'),
    );
    expect([...merged.rowKeys]).toEqual([
      ['r', 'r'],
      ['z', 'g|z'],
    ]);
    expect(merged.leaving).toEqual(['c|r']);

    const gone = carryRowKeys([['r']], new Map(), (combo) => combo.filter((key) => key !== 'r'));
    expect(gone.rowKeys.size).toBe(0);
    expect(gone.leaving).toEqual(['r']);

    const dropped = carryRowKeys([['r'], ['z']], new Map(), (combo) => (combo.includes('r') ? null : combo));
    expect([...dropped.rowKeys]).toEqual([['z', 'z']]);
    expect(dropped.leaving).toEqual(['r']);
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
    sharedStock: false,
    productPrice: '50',
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

  it('needs a price from the row or the general one — blank over blank only', () => {
    expect(variantRowIssues(row(['r'], { quantity: '1' }), context({ productPrice: '' }))).toEqual([
      { field: 'rentPrice', issue: 'variantPriceRequired' },
    ]);
    expect(
      variantRowIssues(row(['r'], { quantity: '1' }), context({ isRent: false, productPrice: ' ' })),
    ).toEqual([{ field: 'sellPrice', issue: 'variantPriceRequired' }]);
    // An invalid general price speaks on its own field; the row stays quiet.
    expect(variantRowIssues(row(['r'], { quantity: '1' }), context({ productPrice: 'x' }))).toEqual([]);
  });

  it('skips the row stock when the stock is SHARED', () => {
    expect(variantRowIssues(row(['r'], { quantity: '' }), context({ sharedStock: true }))).toEqual([]);
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

  it('counts a SHARED stock as one pool across its variations', () => {
    expect(poolKeyOf({ sharedStock: true }, 4, 7)).toBe('4:');
    expect(poolKeyOf({ sharedStock: false }, 4, 7)).toBe('4:7');
    expect(poolKeyOf(undefined, 4, 7)).toBe('4:7');
  });

  it('ranges any effective figure, and names the picks so far', () => {
    expect(variantRange(product(), (entry) => entry.securityDeposit)).toEqual({ min: 0, max: 0 });
    expect(variantRange(product(), (entry) => entry.replacementPrice)).toBeNull();
    expect(pickedLabel(product(), [2, null])).toBe('Azul');
    expect(pickedLabel(product(), [2, 3])).toBe('Azul · Redondo');
    expect(pickedLabel({ options: undefined }, [])).toBe('');
  });

  it('knows which colours need an outline on white', () => {
    expect(isLightColor('#fffff0')).toBe(true);
    expect(isLightColor('#FFFFFF')).toBe(true);
    expect(isLightColor('#000000')).toBe(false);
    expect(isLightColor('#0a0a0a')).toBe(false);
    expect(isLightColor('marfil')).toBe(false);
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
  });

  it('walks the cover chain past a photoless default: next variation, then any value', () => {
    // The default (Azul · Redondo) has none left → the next variation, Rojo · Redondo.
    const bare = product({ images: [] });
    bare.options![1].values[0].images = [];
    expect(photoSetFor(bare, []).map((i) => i.id)).toEqual([11]);
    // No variations offered at all → the first value that has photos.
    expect(photoSetFor(product({ images: [], variants: [] }), []).map((i) => i.id)).toEqual([11]);
    // Nothing anywhere → the (empty) showcase.
    bare.options![0].values[0].images = [];
    expect(photoSetFor(bare, [])).toEqual([]);
  });
});
