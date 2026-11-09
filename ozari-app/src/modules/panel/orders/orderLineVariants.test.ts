import { describe, expect, it } from 'vitest';
import type { Product, ProductVariant } from '../products/product.types';
import { currentPicks, linePhotoUrl, nextPicks, valueChoices } from './orderLineVariants';

// Color (Rojo 1, Azul 2) × Tamaño (Redondo 3, Cuadrado 4); Azul · Cuadrado is NOT offered.
const variant = (id: number, valueIds: number[], label: string): ProductVariant => ({
  id,
  valueIds,
  label,
  isDefault: false,
});
const mantel: Pick<Product, 'options' | 'variants'> = {
  options: [
    {
      id: 10,
      name: 'Color',
      sortOrder: 0,
      kind: 'generic' as const,
      values: [
        { id: 1, name: 'Rojo', sortOrder: 0, images: [] },
        { id: 2, name: 'Azul', sortOrder: 1, images: [] },
      ],
    },
    {
      id: 11,
      name: 'Tamaño',
      sortOrder: 1,
      kind: 'generic' as const,
      values: [
        { id: 3, name: 'Redondo', sortOrder: 0, images: [] },
        { id: 4, name: 'Cuadrado', sortOrder: 1, images: [] },
      ],
    },
  ],
  variants: [
    variant(71, [1, 3], 'Rojo · Redondo'),
    variant(72, [4, 1], 'Rojo · Cuadrado'), // value ids arrive in any order
    variant(73, [2, 3], 'Azul · Redondo'),
  ],
};
const all = () => true;

describe('currentPicks', () => {
  it("shows the line's variation, else its partial picks padded to one per option", () => {
    expect(currentPicks(mantel, { variantId: 72, pickedValues: [] })).toEqual([1, 4]);
    expect(currentPicks(mantel, { variantId: null, pickedValues: [2] })).toEqual([2, null]);
    expect(currentPicks(mantel, { variantId: 99 })).toEqual([null, null]);
    expect(currentPicks({}, { variantId: null })).toEqual([]);
  });
});

describe('nextPicks', () => {
  it('sets the option and clears a later pick the new value cannot reach', () => {
    // Rojo · Cuadrado → switch to Azul: Azul · Cuadrado is not offered, so Tamaño clears.
    expect(nextPicks(mantel, [1, 4], 0, 2)).toEqual([2, null]);
    // Rojo · Redondo → Azul keeps Redondo (Azul · Redondo exists).
    expect(nextPicks(mantel, [1, 3], 0, 2)).toEqual([2, 3]);
    // Clearing the first pick keeps later ones that still lead somewhere.
    expect(nextPicks(mantel, [1, 4], 0, null)).toEqual([null, 4]);
    expect(nextPicks(mantel, [null, null], 1, 3)).toEqual([null, 3]);
    expect(nextPicks({ options: mantel.options }, [1, 4], 0, 2)).toEqual([2, null]);
  });

  it('only counts variations the line may take', () => {
    // Azul · Redondo is taken elsewhere → switching Rojo · Redondo to Azul clears the size.
    expect(nextPicks(mantel, [1, 3], 0, 2, (candidate) => candidate.id !== 73)).toEqual([2, null]);
  });
});

describe('valueChoices', () => {
  it('offers only the values the earlier picks still lead to', () => {
    expect(valueChoices(mantel, [null, null], 0, all).map((v) => v.id)).toEqual([1, 2]);
    expect(valueChoices(mantel, [2, null], 1, all).map((v) => v.id)).toEqual([3]);
    expect(valueChoices(mantel, [1, null], 1, all).map((v) => v.id)).toEqual([3, 4]);
  });

  it('drops values whose variations the line may not take, but keeps the current pick listed', () => {
    const notRojoRedondo = (candidate: ProductVariant) => candidate.id !== 71;
    expect(valueChoices(mantel, [1, null], 1, notRojoRedondo).map((v) => v.id)).toEqual([4]);
    expect(valueChoices(mantel, [1, 3], 1, notRojoRedondo).map((v) => v.id)).toEqual([3, 4]);
  });

  it('ignores a variation that names no value for the option', () => {
    const partial = { ...mantel, variants: [variant(75, [2], 'Azul')] };
    expect(valueChoices(partial, [null, null], 1, all)).toEqual([]);
  });

  it('is empty for an option the product does not have, or without variations', () => {
    expect(valueChoices(mantel, [], 5, all)).toEqual([]);
    expect(valueChoices({ options: mantel.options }, [null, null], 0, all)).toEqual([]);
  });
});

describe('linePhotoUrl', () => {
  const photo = (id: number, url: string, isPrimary = false) => ({ id, url, isPrimary, sortOrder: id });
  // Rojo has its own photos (the second one starred); Azul has none; the showcase has one.
  const product = {
    id: 5,
    name: 'Mantel',
    images: [photo(1, 'https://cdn/showcase.webp')],
    coverImageUrl: 'https://cdn/cover-default.webp',
    options: [
      {
        ...mantel.options![0],
        values: [
          { id: 1, name: 'Rojo', sortOrder: 0, images: [photo(2, 'https://cdn/rojo-a.webp'), photo(3, 'https://cdn/rojo-b.webp', true)] },
          { id: 2, name: 'Azul', sortOrder: 1, images: [] },
        ],
      },
      mantel.options![1],
    ],
    variants: mantel.variants,
  } as unknown as Product;

  it("shows the product's COVER until something is picked — the photo its picker row wore", () => {
    expect(linePhotoUrl(product, [])).toBe('https://cdn/cover-default.webp');
    expect(linePhotoUrl(product, [null, null])).toBe('https://cdn/cover-default.webp');
  });

  it("follows the picks: the first picked value's starred photo, even before the variation is complete", () => {
    expect(linePhotoUrl(product, [1, null])).toBe('https://cdn/rojo-b.webp');
    expect(linePhotoUrl(product, [1, 3])).toBe('https://cdn/rojo-b.webp');
  });

  it('a pick without photos shows the showcase — never the cover, which may be another colour', () => {
    expect(linePhotoUrl(product, [2, 3])).toBe('https://cdn/showcase.webp');
    // …and with no showcase either, nothing (the brand placeholder), not the default's photo.
    expect(linePhotoUrl({ ...product, images: [] }, [2, 3])).toBeNull();
  });
});
