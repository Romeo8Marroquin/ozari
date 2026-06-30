import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from './storage';

/**
 * RFC 4122 v4 UUID. Prefers `crypto.randomUUID()`, but that API is only defined in a SECURE
 * CONTEXT (HTTPS or localhost). When the app is opened over plain HTTP on a LAN IP — e.g. testing
 * on a phone at `http://192.168.x.x:5173` — `crypto.randomUUID` is `undefined` and calling it
 * throws. Since this runs inside the axios request interceptor for any `deviceUuid` request
 * (login), that throw aborts the request before it's sent. `crypto.getRandomValues()` IS available
 * in non-secure contexts, so we build the v4 from it as a fallback.
 */
const generateUuidV4 = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const getOrCreateDeviceUuid = (): string => {
  let deviceUuid = Storage.get<string>(StorageKeys.DEVICE_UUID);

  if (!deviceUuid) {
    deviceUuid = generateUuidV4();
    Storage.set(StorageKeys.DEVICE_UUID, deviceUuid);
  }

  return deviceUuid;
};
