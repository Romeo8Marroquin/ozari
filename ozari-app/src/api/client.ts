import { StorageKeys } from '@constants/StorageKeys';
import { notify } from '@components/notifications/notify';
import { getOrCreateDeviceUuid } from '@utils/deviceUuid';
import { Storage } from '@utils/storage';
import { refreshAccessToken, subscribeTokenRefresh, getIsRefreshing } from '@utils/tokenRefresh';
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import i18next from 'i18next';

const SAFE_METHODS = new Set(['get', 'head', 'options']);

/**
 * Resolves a single, user-friendly message for a failed request. The backend already
 * returns a localized, friendly `message` (see `sendOzariError`) so we prefer that; we
 * only synthesize copy for cases the server can't speak to (no response = network/timeout)
 * or a response that somehow carries no message (e.g. a bare 5xx).
 */
function resolveApiErrorMessage(error: AxiosError): string {
  if (!error.response) return i18next.t('errors.network');

  const data = error.response.data as { message?: string } | undefined;
  if (typeof data?.message === 'string' && data.message.trim()) return data.message;

  const status = error.response.status;
  if (status === 429) return i18next.t('errors.tooManyRequests');
  if (status >= 500) return i18next.t('errors.server');
  if (status === 401 || status === 403) return i18next.t('errors.unauthorized');
  return i18next.t('errors.generic');
}

/**
 * Whether a failed request should raise a notification. Default policy: notify on failed
 * **mutations** (non-GET) — those are user-initiated actions where the user is owed
 * feedback — and stay silent on reads (queries / route-guard probes handle their own
 * empty/error states). Always silent for the token-refresh round-trip and for any request
 * that explicitly opted out via `skipErrorNotification`.
 */
function shouldNotifyError(error: AxiosError): boolean {
  const config = error.config as
    | (InternalAxiosRequestConfig & { skipErrorNotification?: boolean; _isRefreshRequest?: boolean })
    | undefined;
  if (!config || config.skipErrorNotification || config._isRefreshRequest) return false;
  return !SAFE_METHODS.has(config.method?.toLowerCase() ?? 'get');
}

/** Reject, first surfacing a friendly error toast unless this request opted out. */
function rejectWithNotice(error: AxiosError): Promise<never> {
  if (shouldNotifyError(error)) notify.error(resolveApiErrorMessage(error));
  return Promise.reject(error);
}

export const api = axios.create({
  baseURL: import.meta.env.DEV ? '/api' : `${import.meta.env.VITE_API_URL}/api`,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

const csrfSafeMethods = new Set(['get', 'head', 'options']);

function getCookie(name: string): string | null {
  const value = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split('=')[1];

  return value ? decodeURIComponent(value) : null;
}

api.interceptors.request.use((config) => {
  if (config.deviceUuid) {
    const deviceUuid = getOrCreateDeviceUuid();
    config.headers['device-uuid'] = deviceUuid;
  }

  const method = config.method?.toLowerCase() ?? 'get';
  const csrfToken = csrfSafeMethods.has(method) ? null : getCookie('csrf-token');
  if (csrfToken) config.headers['x-csrf-token'] = csrfToken;

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
        return rejectWithNotice(error);
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
      if (import.meta.env.DEV) {
        console.log('[API] 401 detected, attempting token refresh...');
      }
      const newToken = await refreshAccessToken();

      if (newToken) {
        // Retry original request with new token
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }

      // If refresh failed, reject the original request
      return rejectWithNotice(error);
    }

    // For all other errors, just reject (notifying for failed mutations)
    return rejectWithNotice(error);
  }
);
