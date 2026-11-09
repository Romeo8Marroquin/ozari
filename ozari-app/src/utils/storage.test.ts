import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from './storage';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('Storage', () => {
  it('round-trips JSON-serialisable values', () => {
    Storage.set(StorageKeys.CSRF, 'abc');
    expect(Storage.get<string>(StorageKeys.CSRF)).toBe('abc');

    Storage.set(StorageKeys.PANEL_SIDEBAR_COLLAPSED, true);
    expect(Storage.get<boolean>(StorageKeys.PANEL_SIDEBAR_COLLAPSED)).toBe(true);
  });

  it('returns null for a missing key', () => {
    expect(Storage.get(StorageKeys.CSRF)).toBeNull();
  });

  it('returns null (without throwing) on corrupt JSON', () => {
    localStorage.setItem(StorageKeys.CSRF, '{not valid json');
    expect(Storage.get(StorageKeys.CSRF)).toBeNull();
  });

  it('routes the access TOKEN to sessionStorage, everything else to localStorage', () => {
    Storage.set(StorageKeys.TOKEN, 'jwt');
    expect(sessionStorage.getItem(StorageKeys.TOKEN)).toBe(JSON.stringify('jwt'));
    expect(localStorage.getItem(StorageKeys.TOKEN)).toBeNull();

    Storage.set(StorageKeys.CSRF, 'csrf');
    expect(localStorage.getItem(StorageKeys.CSRF)).toBe(JSON.stringify('csrf'));
  });

  it('keeps the order SKETCH in localStorage — a cart outlives the tab and is shared by every tab', () => {
    Storage.set(StorageKeys.ORDER_CREATE_DRAFT, { deliveryName: 'María' });
    expect(localStorage.getItem(StorageKeys.ORDER_CREATE_DRAFT)).not.toBeNull();
    expect(sessionStorage.getItem(StorageKeys.ORDER_CREATE_DRAFT)).toBeNull();
    // The product draft stays per-tab.
    Storage.set(StorageKeys.PRODUCT_CREATE_DRAFT, { name: 'Mesa' });
    expect(sessionStorage.getItem(StorageKeys.PRODUCT_CREATE_DRAFT)).not.toBeNull();
  });

  it('raw hands back the stored text unparsed, and null when the store refuses', () => {
    expect(Storage.raw(StorageKeys.CSRF)).toBeNull();
    Storage.set(StorageKeys.CSRF, 'abc');
    expect(Storage.raw(StorageKeys.CSRF)).toBe(JSON.stringify('abc'));
    vi.spyOn(Object.getPrototypeOf(localStorage) as globalThis.Storage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(Storage.raw(StorageKeys.CSRF)).toBeNull();
    vi.restoreAllMocks();
  });

  it('remove deletes a single key from its backing store', () => {
    Storage.set(StorageKeys.TOKEN, 'jwt');
    Storage.remove(StorageKeys.TOKEN);
    expect(Storage.get(StorageKeys.TOKEN)).toBeNull();
  });

  it('clear wipes both stores', () => {
    Storage.set(StorageKeys.TOKEN, 'jwt');
    Storage.set(StorageKeys.CSRF, 'csrf');
    Storage.clear();
    expect(Storage.get(StorageKeys.TOKEN)).toBeNull();
    expect(Storage.get(StorageKeys.CSRF)).toBeNull();
  });

  it('set swallows serialization errors instead of throwing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular; // JSON.stringify throws on a cycle
    expect(() => Storage.set(StorageKeys.CSRF, circular)).not.toThrow();
    expect(Storage.get(StorageKeys.CSRF)).toBeNull();
  });
});
