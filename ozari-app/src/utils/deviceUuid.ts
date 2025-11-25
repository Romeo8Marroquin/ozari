import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from './storage';

export const getOrCreateDeviceUuid = (): string => {
  let deviceUuid = Storage.get<string>(StorageKeys.DEVICE_UUID);

  if (!deviceUuid) {
    deviceUuid = crypto.randomUUID();
    Storage.set(StorageKeys.DEVICE_UUID, deviceUuid);
  }

  return deviceUuid;
};
