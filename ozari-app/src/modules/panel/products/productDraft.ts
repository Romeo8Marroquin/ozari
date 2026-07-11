import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createProductDefaultValues, type CreateProductFormType } from './SchemaCreateProduct';

/**
 * Silent draft persistence for the product create form — the friendly alternative to a blocking
 * "are you sure you want to leave?" dialog: the form autosaves as the admin types (sessionStorage:
 * survives refresh and navigation, dies with the tab, and is user-scoped — `clearAuthState` removes
 * it on logout). Restored on return with a visible note + an explicit discard; cleared on a
 * successful create. Never nags, never loses work.
 */

/** The stored draft merged over the current defaults (shape-tolerant: unknown keys are dropped,
 *  missing ones fall back), or `null` when there is no usable draft. */
export function readProductDraft(): CreateProductFormType | null {
  const stored = Storage.get<Partial<CreateProductFormType>>(StorageKeys.PRODUCT_CREATE_DRAFT);
  if (!stored || typeof stored !== 'object') return null;
  const draft: CreateProductFormType = {
    ...createProductDefaultValues,
    ...stored,
    details: Array.isArray(stored.details)
      ? stored.details.map((row) => ({
          detailTypeId: typeof row?.detailTypeId === 'number' ? row.detailTypeId : null,
          detail: typeof row?.detail === 'string' ? row.detail : '',
        }))
      : [],
  } as CreateProductFormType;
  return isMeaningfulDraft(draft) ? draft : null;
}

export function saveProductDraft(values: CreateProductFormType): void {
  Storage.set(StorageKeys.PRODUCT_CREATE_DRAFT, values);
}

export function clearProductDraft(): void {
  Storage.remove(StorageKeys.PRODUCT_CREATE_DRAFT);
}

/** True when the values differ from a pristine form — an untouched draft isn't worth keeping. */
export function isMeaningfulDraft(values: CreateProductFormType): boolean {
  return JSON.stringify(values) !== JSON.stringify(createProductDefaultValues);
}
