import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createOrderDefaultValues, type CreateOrderFormType } from './SchemaCreateOrder';

/**
 * The order create form's draft — which is also the admin's CART, the order SKETCH (`orderSketch.ts`):
 * the product grid and the product detail page add lines to it, the header button counts them, and the
 * form restores it. It started as the same silent-draft contract `productDraft` established (the
 * friendly alternative to a blocking "are you sure you want to leave?" dialog) and grew into the cart
 * on 2026-11-09, which changed two things:
 *
 * - **localStorage, not sessionStorage.** A cart has to survive closing the tab and be the SAME cart in
 *   every tab — the header of one tab must never count lines the form in another cannot see. It still
 *   never leaves the device (the API is only called when the order is created), and it is still
 *   user-scoped: `clearAuthState` removes it on logout.
 * - **Always on.** The `forms.saveDraftOrders` switch was retired: a cart that can be switched off is a
 *   button that silently does nothing.
 *
 * Restored on return with a visible note + an explicit discard; cleared on a successful create. Never
 * nags, never loses work. Every write and clear here NOTIFIES the subscribers (`subscribeOrderDraft`),
 * so the header count follows the form keystroke by keystroke in the same tab; other tabs hear the
 * browser's own `storage` event.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

/** Fires on every write/clear in THIS tab, and on a change made by ANOTHER tab (`storage` event). */
export function subscribeOrderDraft(listener: Listener): () => void {
  listeners.add(listener);
  const fromOtherTab = (event: StorageEvent): void => {
    // `key === null` is another tab's `localStorage.clear()` — the sketch went with it.
    if (event.key === null || event.key === StorageKeys.ORDER_CREATE_DRAFT) listener();
  };
  window.addEventListener('storage', fromOtherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', fromOtherTab);
  };
}

/** The stored text — the snapshot IDENTITY for `useSyncExternalStore` (equal text, same draft). */
export const orderDraftText = (): string | null => Storage.raw(StorageKeys.ORDER_CREATE_DRAFT);

/**
 * The stored draft merged over the current defaults, or `null` when there is no usable draft.
 *
 * Shape-TOLERANT on purpose: a draft written before a field existed (or after one was removed) is
 * still worth restoring, so unknown keys are dropped and missing ones fall back. The one part that
 * needs real care is `lines` — an array of objects the form iterates and reads three properties
 * from, so a malformed row would crash the render rather than merely look wrong.
 */
export function readOrderDraft(): CreateOrderFormType | null {
  const stored = Storage.get<Partial<CreateOrderFormType>>(StorageKeys.ORDER_CREATE_DRAFT);
  if (!stored || typeof stored !== 'object') return null;
  // Only keys the form still HAS. Derived from the defaults rather than listed, so a field added or
  // removed needs no change here — and a draft written before a rename cannot smuggle a dead key
  // into RHF's state, where it would ride along invisibly for the rest of the session.
  const known = Object.fromEntries(
    Object.entries(stored).filter(([key]) => key in createOrderDefaultValues),
  ) as Partial<CreateOrderFormType>;
  const draft: CreateOrderFormType = {
    ...createOrderDefaultValues,
    ...known,
    lines: Array.isArray(stored.lines)
      ? stored.lines.map((row) => ({
          productId: typeof row?.productId === 'number' ? row.productId : (null as unknown as number),
          // Drafts written before variations existed carry neither field — they read as "no
          // variation picked yet", which the resolver then asks for when the product has some.
          variantId: typeof row?.variantId === 'number' ? row.variantId : null,
          pickedValues: Array.isArray(row?.pickedValues)
            ? row.pickedValues.map((pick) => (typeof pick === 'number' ? pick : null))
            : [],
          quantity: typeof row?.quantity === 'string' ? row.quantity : '',
          isRental: row?.isRental === true,
        }))
      : createOrderDefaultValues.lines,
    // The pin is the other structured field. A half-written `{ lat }` would put `undefined` into a
    // map deep link, so it is all-or-nothing.
    deliveryCoords:
      typeof stored.deliveryCoords?.lat === 'number' && typeof stored.deliveryCoords?.lng === 'number'
        ? { lat: stored.deliveryCoords.lat, lng: stored.deliveryCoords.lng }
        : null,
  } as CreateOrderFormType;
  return isMeaningfulOrderDraft(draft) ? draft : null;
}

export function saveOrderDraft(values: CreateOrderFormType): void {
  const before = orderDraftText();
  Storage.set(StorageKeys.ORDER_CREATE_DRAFT, values);
  // The form autosaves on every render of its values; only a REAL change is news.
  if (orderDraftText() !== before) emit();
}

export function clearOrderDraft(): void {
  if (orderDraftText() === null) return;
  Storage.remove(StorageKeys.ORDER_CREATE_DRAFT);
  emit();
}

/**
 * True when the values differ from a pristine form — an untouched draft isn't worth keeping, and
 * restoring one would show the "we kept your work" note to somebody who did none.
 *
 * The order form's defaults are not entirely static (the assignee defaults to the signed-in admin
 * and the delivery date can be prefilled), so this compares against the SAME defaults the form was
 * seeded with rather than a frozen snapshot.
 */
export function isMeaningfulOrderDraft(
  values: CreateOrderFormType,
  defaults: CreateOrderFormType = createOrderDefaultValues,
): boolean {
  return JSON.stringify(values) !== JSON.stringify(defaults);
}
