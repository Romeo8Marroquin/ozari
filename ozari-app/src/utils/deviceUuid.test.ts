import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKeys } from '@constants/StorageKeys';
import { getOrCreateDeviceUuid } from './deviceUuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => localStorage.clear());

describe('getOrCreateDeviceUuid', () => {
  it('generates a v4 UUID and persists it', () => {
    const uuid = getOrCreateDeviceUuid();
    expect(uuid).toMatch(UUID_V4);
    expect(localStorage.getItem(StorageKeys.DEVICE_UUID)).toBe(JSON.stringify(uuid));
  });

  it('returns the same UUID on subsequent calls (stable per device)', () => {
    const first = getOrCreateDeviceUuid();
    const second = getOrCreateDeviceUuid();
    expect(second).toBe(first);
  });

  it('falls back to getRandomValues when randomUUID is unavailable (non-secure context)', () => {
    // Simulate a non-secure context (LAN IP over HTTP): `crypto.randomUUID` is undefined there.
    const originalRandomUUID = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    const getRandomValues = vi.spyOn(crypto, 'getRandomValues').mockImplementation((arr) => {
      (arr as Uint8Array).fill(0xab);
      return arr;
    });

    try {
      const uuid = getOrCreateDeviceUuid();
      expect(getRandomValues).toHaveBeenCalled();
      expect(uuid).toMatch(UUID_V4); // version (4) + variant (8-b) bits are still forced on
    } finally {
      Object.defineProperty(crypto, 'randomUUID', {
        value: originalRandomUUID,
        configurable: true,
      });
      getRandomValues.mockRestore();
    }
  });
});
