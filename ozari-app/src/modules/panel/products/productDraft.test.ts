import { beforeEach, describe, expect, it } from 'vitest';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import {
  clearProductDraft,
  isMeaningfulDraft,
  readProductDraft,
  saveProductDraft,
} from './productDraft';
import { createProductDefaultValues, type CreateProductFormType } from './SchemaCreateProduct';

const meaningful = (): CreateProductFormType => ({
  ...createProductDefaultValues,
  name: 'Mesa redonda',
  details: [{ detailTypeId: 1, detail: 'Blanco nieve' }],
});

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('productDraft', () => {
  it('returns null when nothing is stored', () => {
    expect(readProductDraft()).toBeNull();
  });

  it('round-trips a meaningful draft (sessionStorage — survives a refresh, dies with the tab)', () => {
    saveProductDraft(meaningful());
    expect(sessionStorage.getItem(StorageKeys.PRODUCT_CREATE_DRAFT)).not.toBeNull();
    expect(readProductDraft()).toMatchObject({ name: 'Mesa redonda' });
  });

  it('merges a PARTIAL stored draft over the current defaults (shape-tolerant)', () => {
    Storage.set(StorageKeys.PRODUCT_CREATE_DRAFT, { name: 'Sólo nombre' });
    const draft = readProductDraft();
    expect(draft).toMatchObject({ name: 'Sólo nombre', currencyId: createProductDefaultValues.currencyId });
    expect(draft?.details).toEqual([]);
  });

  it('sanitizes malformed detail rows and non-array details', () => {
    Storage.set(StorageKeys.PRODUCT_CREATE_DRAFT, {
      name: 'Mesa redonda',
      details: [{ detailTypeId: 'x', detail: 42 }, { detailTypeId: 2, detail: 'Roble' }],
    });
    expect(readProductDraft()?.details).toEqual([
      { detailTypeId: null, detail: '' },
      { detailTypeId: 2, detail: 'Roble' },
    ]);

    Storage.set(StorageKeys.PRODUCT_CREATE_DRAFT, { name: 'Mesa redonda', details: 'nope' });
    expect(readProductDraft()?.details).toEqual([]);
  });

  it('treats a stored draft equal to the defaults as no draft at all', () => {
    Storage.set(StorageKeys.PRODUCT_CREATE_DRAFT, createProductDefaultValues);
    expect(readProductDraft()).toBeNull();
  });

  it('ignores a non-object payload', () => {
    Storage.set(StorageKeys.PRODUCT_CREATE_DRAFT, 'garbage');
    expect(readProductDraft()).toBeNull();
  });

  it('clears the draft', () => {
    saveProductDraft(meaningful());
    clearProductDraft();
    expect(readProductDraft()).toBeNull();
  });

  it('isMeaningfulDraft distinguishes pristine from edited values', () => {
    expect(isMeaningfulDraft(createProductDefaultValues)).toBe(false);
    expect(isMeaningfulDraft(meaningful())).toBe(true);
  });
});
