import { StorageKeys } from '@constants/StorageKeys';
import { notify } from '@components/notifications/notify';
import { getOrCreateDeviceUuid } from '@utils/deviceUuid';
import { Storage } from '@utils/storage';
import { getStatus, isNetworkError, isOutageStatus, isTransientStatus, resolveApiErrorMessage } from '@utils/apiError';
import { isForcedLogoutInFlight } from '@utils/sessionLifecycle';
import { probeBackendMaybeOutage } from '@utils/outageProbe';
import { isOutageActive, reportOutage } from '../stores/outageStore';
import { refreshAccessToken, subscribeTokenRefresh, getIsRefreshing } from '@utils/tokenRefresh';
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

const SAFE_METHODS = new Set(['get', 'head', 'options']);

/**
 * Whether a failed request should raise a notification. The policy, by *concern* rather than by
 * status code alone:
 *  - **Transient/global** failures (network, 429, 5xx) always surface — the user must know to slow
 *    down or that the server is down — even on a read.
 *  - **403 forbidden** always surfaces with the backend's message ("no tienes permiso"). By design
 *    the UI role-hides controls so a 403 shouldn't happen in normal use; if one does (a stale-role
 *    race, a bug, or someone poking devtools) it's a defense-in-depth denial — inform clearly with a
 *    non-blocking toast, don't take over the screen.
 *  - Everything else notifies only on **mutations** (user-initiated actions owed feedback); reads
 *    stay quiet and handle their own empty/error states.
 * Always silent for the token-refresh round-trip (its own flow owns the outcome), for a request
 * that opted out via `skipErrorNotification`, and while a forced logout is in flight (the teardown
 * owns the messaging then).
 */
function shouldNotifyError(error: AxiosError): boolean {
  const config = error.config as
    | (InternalAxiosRequestConfig & { skipErrorNotification?: boolean; _isRefreshRequest?: boolean })
    | undefined;
  if (!config || config.skipErrorNotification || config._isRefreshRequest) return false;
  if (isForcedLogoutInFlight()) return false;
  // Offline → the app overlay owns it; a network-error toast would just be noise.
  if (!navigator.onLine) return false;

  const status = getStatus(error);
  // The outage overlay owns backend-down states — don't also toast (before AND while it's up).
  if (isOutageStatus(status) || isOutageActive()) return false;
  // A 403 is a permission denial — always surface it (with the backend's message), even on a read.
  if (isTransientStatus(status) || status === 403) return true;

  /* v8 ignore next -- `?? 'get'` is a defensive fallback; axios always sets config.method */
  return !SAFE_METHODS.has(config.method?.toLowerCase() ?? 'get');
}

/** Reject, first surfacing a friendly error toast unless this request opted out. */
function rejectWithNotice(error: AxiosError): Promise<never> {
  if (shouldNotifyError(error)) notify.error(resolveApiErrorMessage(error));
  return Promise.reject(error);
}

export const api = axios.create({
  /* v8 ignore next -- module-load config; only the DEV branch runs under test */
  baseURL: import.meta.env.DEV ? '/api' : `${import.meta.env.VITE_API_URL}/api`,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

const csrfSafeMethods = new Set(['get', 'head', 'options']);

api.interceptors.request.use((config) => {
  if (config.deviceUuid) {
    const deviceUuid = getOrCreateDeviceUuid();
    config.headers['device-uuid'] = deviceUuid;
  }

  // CSRF: echo the token the API handed us (login/refresh response header) back in the
  // request header on state-changing calls. It's read from storage — not a cookie —
  // because the FE and API are on different domains in deployed envs, where a cookie set
  // by the API can't be read by the FE's JS. See csrf.middleware.ts on the backend.
  /* v8 ignore next -- `?? 'get'` is a defensive fallback; axios always sets config.method */
  const method = config.method?.toLowerCase() ?? 'get';
  const csrfToken = csrfSafeMethods.has(method)
    ? null
    : Storage.get<string>(StorageKeys.CSRF);
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

    // Backend down (gateway/unavailable) → raise the global outage overlay, which then polls health
    // and recovers. Skip when this failure IS the health probe (it drives its own retry loop).
    if (isOutageStatus(error.response?.status) && !originalRequest._isHealthCheck) {
      reportOutage();
    }

    // A dead/unreachable backend fails as a NETWORK error (connection refused / DNS / timeout), not a
    // 5xx. Confirm via a single health probe before raising the overlay, so a one-off blip on an
    // otherwise-live backend doesn't false-trigger it. (Offline is handled by the `offline` event.)
    if (
      isNetworkError(error) &&
      navigator.onLine &&
      !originalRequest._isHealthCheck &&
      !originalRequest._isRefreshRequest
    ) {
      void probeBackendMaybeOutage();
    }

    // If error is 401 and we haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Don't retry if this is a public endpoint (login, etc.) or the refresh request itself
      if (originalRequest.public || originalRequest._isRefreshRequest) {
        return rejectWithNotice(error);
      }

      // Mark request as retried to prevent infinite loops
      originalRequest._retry = true;

      // If already refreshing, wait for it to complete (or fail — `null` = give up quietly).
      if (getIsRefreshing()) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((token) => {
            if (!token) {
              resolve(Promise.reject(error));
              return;
            }
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      // Attempt to refresh token
      /* v8 ignore next 3 -- dev-only logging; `import.meta.env.DEV` is false under test */
      if (import.meta.env.DEV) {
        console.log('[API] 401 detected, attempting token refresh...');
      }
      const newToken = await refreshAccessToken();

      if (newToken) {
        // Retry original request with new token
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }

      // Refresh failed: `refreshAccessToken` already owned the outcome — either the graceful
      // forced-logout choreography (auth-dead) or a transient warning toast. Reject quietly so we
      // never double-notify with a misleading "session invalid" on a transient blip.
      return Promise.reject(error);
    }

    // For all other errors, just reject (notifying for failed mutations)
    return rejectWithNotice(error);
  }
);
