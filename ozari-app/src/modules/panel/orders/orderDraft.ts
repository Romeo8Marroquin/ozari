import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createOrderDefaultValues, type CreateOrderFormType } from './SchemaCreateOrder';

/**
 * Silent draft persistence for the order create form — the same contract `productDraft` established,
 * and for the same reason: the friendly alternative to a blocking "are you sure you want to leave?"
 * dialog. The form autosaves as the admin types (sessionStorage: survives a refresh and a navigation
 * away and back, dies with the tab, and is user-scoped — `clearAuthState` removes it on logout).
 * Restored on return with a visible note + an explicit discard; cleared on a successful create.
 * Never nags, never loses work.
 *
 * An order form is where this matters most: it is the longest form in the panel, it is often filled
 * while the client is on the phone, and it is the one an admin most often steps away from to go and
 * check a product or a client.
 *
 * **Honours `forms.saveDrafts`** — the caller checks the preference; this module only knows how to
 * read, write and forget. Keeping the switch out of here is what lets the same three functions be
 * tested without a query client.
 */

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
  Storage.set(StorageKeys.ORDER_CREATE_DRAFT, values);
}

export function clearOrderDraft(): void {
  Storage.remove(StorageKeys.ORDER_CREATE_DRAFT);
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
