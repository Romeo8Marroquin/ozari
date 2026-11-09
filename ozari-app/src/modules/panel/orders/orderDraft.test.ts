import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import {
  clearOrderDraft,
  isMeaningfulOrderDraft,
  orderDraftText,
  readOrderDraft,
  saveOrderDraft,
  subscribeOrderDraft,
} from './orderDraft';
import { createOrderDefaultValues, type CreateOrderFormType } from './SchemaCreateOrder';

const values = (over: Partial<CreateOrderFormType> = {}): CreateOrderFormType =>
  ({ ...createOrderDefaultValues, ...over }) as CreateOrderFormType;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('orderDraft', () => {
  it('round-trips a draft through localStorage', () => {
    const draft = values({ deliveryName: 'María', deliveryAddress: 'Salón del club' });
    saveOrderDraft(draft);
    expect(readOrderDraft()).toMatchObject({
      deliveryName: 'María',
      deliveryAddress: 'Salón del club',
    });
  });

  it('lives in localStorage — it is the CART, so it outlives the tab and is shared by every tab', () => {
    // The header of one tab must never count lines the form in another cannot see. Logout still
    // removes it (`clearAuthState`), so a shared machine never hands it to the next person.
    saveOrderDraft(values({ deliveryName: 'María' }));
    expect(localStorage.getItem(StorageKeys.ORDER_CREATE_DRAFT)).not.toBeNull();
    expect(sessionStorage.getItem(StorageKeys.ORDER_CREATE_DRAFT)).toBeNull();
  });

  it('tells its subscribers about a REAL change only — in this tab and from another one', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOrderDraft(listener);
    saveOrderDraft(values({ deliveryName: 'María' }));
    expect(listener).toHaveBeenCalledTimes(1);
    // The form autosaves on every render; writing the same values again is not news.
    saveOrderDraft(values({ deliveryName: 'María' }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(orderDraftText()).toBe(JSON.stringify(values({ deliveryName: 'María' })));

    clearOrderDraft();
    expect(listener).toHaveBeenCalledTimes(2);
    clearOrderDraft(); // nothing left to clear
    expect(listener).toHaveBeenCalledTimes(2);

    // Another tab: its own key, or a whole-store clear (`key: null`). Anything else is not ours.
    window.dispatchEvent(new StorageEvent('storage', { key: StorageKeys.ORDER_CREATE_DRAFT }));
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    window.dispatchEvent(new StorageEvent('storage', { key: StorageKeys.CSRF }));
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    saveOrderDraft(values({ deliveryName: 'Ana' }));
    window.dispatchEvent(new StorageEvent('storage', { key: StorageKeys.ORDER_CREATE_DRAFT }));
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('has nothing to restore when the form was never touched', () => {
    // Restoring a pristine form would show "we kept your work" to somebody who did none.
    saveOrderDraft(values());
    expect(readOrderDraft()).toBeNull();
  });

  it('reads a draft written before a field existed', () => {
    // Shape-tolerant on purpose: unknown keys are dropped and missing ones fall back, so a draft
    // does not become unrestorable the moment the form gains or loses a field.
    Storage.set(StorageKeys.ORDER_CREATE_DRAFT, {
      deliveryName: 'María',
      campoQueYaNoExiste: true,
    });
    const draft = readOrderDraft();
    expect(draft?.deliveryName).toBe('María');
    expect(draft).not.toHaveProperty('campoQueYaNoExiste');
    // Everything it did not carry comes from the defaults, so the form is still complete.
    expect(draft?.deliveryAddress).toBe(createOrderDefaultValues.deliveryAddress);
  });

  it('repairs malformed LINES rather than letting them reach the render', () => {
    // The form iterates these and reads three properties off each row, so a junk entry would crash
    // the page rather than merely look wrong.
    Storage.set(StorageKeys.ORDER_CREATE_DRAFT, {
      deliveryName: 'María',
      lines: [
        { productId: 3, quantity: '2', isRental: true },
        null,
        { quantity: 7 },
        { productId: 7, variantId: 71, pickedValues: [1, 'x', null], quantity: '1', isRental: true },
      ],
    });
    // A draft written before variations existed reads as "no variation picked yet".
    expect(readOrderDraft()?.lines).toEqual([
      { productId: 3, variantId: null, pickedValues: [], quantity: '2', isRental: true },
      { productId: null, variantId: null, pickedValues: [], quantity: '', isRental: false },
      { productId: null, variantId: null, pickedValues: [], quantity: '', isRental: false },
      { productId: 7, variantId: 71, pickedValues: [1, null, null], quantity: '1', isRental: true },
    ]);
  });

  it('drops a HALF-written pin instead of restoring half a coordinate', () => {
    // `{ lat }` with no `lng` would put `undefined` into a maps deep link — a driver sent to the
    // ocean. A pin is all-or-nothing, the same stance `decodeCoords` takes server-side.
    Storage.set(StorageKeys.ORDER_CREATE_DRAFT, { deliveryName: 'María', deliveryCoords: { lat: 14.6 } });
    expect(readOrderDraft()?.deliveryCoords).toBeNull();

    Storage.set(StorageKeys.ORDER_CREATE_DRAFT, {
      deliveryName: 'María',
      deliveryCoords: { lat: 14.6, lng: -90.5 },
    });
    expect(readOrderDraft()?.deliveryCoords).toEqual({ lat: 14.6, lng: -90.5 });
  });

  it('reads nothing from an empty or corrupt slot', () => {
    expect(readOrderDraft()).toBeNull();
    localStorage.setItem(StorageKeys.ORDER_CREATE_DRAFT, 'no es json');
    expect(readOrderDraft()).toBeNull();
  });

  it('forgets on demand', () => {
    saveOrderDraft(values({ deliveryName: 'María' }));
    clearOrderDraft();
    expect(readOrderDraft()).toBeNull();
  });

  it('measures "touched" against the defaults the form was SEEDED with', () => {
    // The order form's defaults are not static — the assignee defaults to the signed-in admin — so
    // comparing against a frozen snapshot would call an untouched form dirty for every admin whose
    // id is not the one baked in.
    const seeded = values({ assignedUserId: 42 as unknown as number });
    expect(isMeaningfulOrderDraft(seeded, seeded)).toBe(false);
    expect(isMeaningfulOrderDraft(seeded)).toBe(true);
  });
});
