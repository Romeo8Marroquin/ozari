import { StorageKeys } from '@constants/StorageKeys';
import { getOrCreateDeviceUuid } from '@utils/deviceUuid';
import { Storage } from '@utils/storage';
import { refreshAccessToken, subscribeTokenRefresh, getIsRefreshing } from '@utils/tokenRefresh';
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.DEV ? '/api' : `${import.meta.env.VITE_API_URL}/api`,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor
api.interceptors.request.use((config) => {
  if (config.deviceUuid) {
    const deviceUuid = getOrCreateDeviceUuid();
    config.headers['device-uuid'] = deviceUuid;
  }
  const apiKey = import.meta.env.VITE_API_KEY;
  if (apiKey) config.headers['x-api-key'] = apiKey;

  if (config.public) {
    return config;
  }
  const token = Storage.get<string>(StorageKeys.TOKEN);
  if (token) config.headers.Authorization = `Bearer ${token}`;

  return config;
});

// Response interceptor for 401 handling (token refresh)
api.interceptors.response.use(
  // Success response - pass through
  (response) => response,

  // Error response - handle 401 with token refresh
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
      _isRefreshRequest?: boolean;
    };

    // If error is 401 and we haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Don't retry if this is a public endpoint (login, etc.) or the refresh request itself
      if (originalRequest.public || originalRequest._isRefreshRequest) {
        return Promise.reject(error);
      }

      // Mark request as retried to prevent infinite loops
      originalRequest._retry = true;

      // If already refreshing, wait for it to complete
      if (getIsRefreshing()) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      // Attempt to refresh token
      console.log('[API] 401 detected, attempting token refresh...');
      const newToken = await refreshAccessToken();

      if (newToken) {
        // Retry original request with new token
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }

      // If refresh failed, reject the original request
      return Promise.reject(error);
    }

    // For all other errors, just reject
    return Promise.reject(error);
  }
);
