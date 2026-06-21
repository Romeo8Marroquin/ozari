import type { StorageKeys } from '@constants/StorageKeys';
import { StorageKeys as StorageKeyValues } from '@constants/StorageKeys';
import i18next from 'i18next';

export const Storage = {
  set: (key: StorageKeys, value: unknown): void => {
    try {
      const serializedValue = JSON.stringify(value);
      getStorage(key).setItem(key, serializedValue);
    } catch (error) {
      console.error(i18next.t('app.localStorageSaveError', { key }), error);
    }
  },

  get: <T>(key: StorageKeys): T | null => {
    try {
      const item = getStorage(key).getItem(key);
      if (item === null) {
        return null;
      }
      return JSON.parse(item) as T;
    } catch (error) {
      console.error(i18next.t('app.localStorageReadError', { key }), error);
      return null;
    }
  },

  remove: (key: StorageKeys): void => {
    getStorage(key).removeItem(key);
  },

  clear: (): void => {
    localStorage.clear();
    sessionStorage.clear();
  },
};

function getStorage(key: StorageKeys): globalThis.Storage {
  return key === StorageKeyValues.TOKEN ? sessionStorage : localStorage;
}
