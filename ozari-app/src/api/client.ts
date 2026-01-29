import { StorageKeys } from '@constants/StorageKeys';
import { getOrCreateDeviceUuid } from '@utils/deviceUuid';
import { Storage } from '@utils/storage';
import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.DEV ? '/api' : `${import.meta.env.VITE_API_URL}/api`,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptors
api.interceptors.request.use((config) => {
  if (config.deviceUuid) {
    const deviceUuid = getOrCreateDeviceUuid();
    config.headers['device-uuid'] = deviceUuid;
  }
  if (config.public) {
    return config;
  }
  const token = Storage.get<string>(StorageKeys.TOKEN);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
