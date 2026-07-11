import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { getTokenTimeRemaining, isTokenValid } from '@utils/jwt';
import { api } from '@api/client';
import { notify } from '@components/notifications/notify';
import { getStatus, isAuthFailure, resolveApiErrorMessage } from '@utils/apiError';
import { requestForcedLogout, resetForcedLogout } from '@utils/sessionLifecycle';
import axios from 'axios';
import type { OzariSuccessResponse } from '../types/api.types';

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let isRefreshing = false;
// Subscribers are queued requests waiting on an in-flight refresh. They receive the new token, or
// `null` when the refresh failed — so they can fail fast instead of hanging forever.
let refreshSubscribers: Array<(token: string | null) => void> = [];

/**
 * Tears down all client-side auth state. Called by the shared session teardown (manual + forced
 * logout) and by the route-guard probes, so "you are no longer logged in" is cleaned up in exactly
 * one place.
 *
 * NOTE: intentionally does NOT redirect or clear the React Query cache — those are the caller's
 * concern (the teardown navigates via the router and clears the query cache). Keep global-store
 * resets here as they come online.
 */
export function clearAuthState(): void {
  Storage.remove(StorageKeys.TOKEN);
  Storage.remove(StorageKeys.CSRF);
  // User-scoped work-in-progress: another user on this browser must never inherit a draft.
  Storage.remove(StorageKeys.PRODUCT_CREATE_DRAFT);
  clearRefreshTimer();

  // 🔴 TODO: reset Zustand stores here when implemented (authStore/userStore .reset()).
}

/**
 * Subscribe to token refresh completion. Used by failed requests to retry after refresh (or to
 * fail fast when it receives `null`).
 */
export function subscribeTokenRefresh(callback: (token: string | null) => void): void {
  refreshSubscribers.push(callback);
}

/** Notify all subscribers of the refresh outcome (token on success, `null` on failure). */
function notifyRefreshSubscribers(token: string | null): void {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
}

interface RefreshOptions {
  /**
   * Silent mode for route-guard probes: don't run the forced-logout choreography or show a toast on
   * failure — just report "no token" so the guard can redirect on its own terms. (Was the old
   * `redirectOnFailure = false` flag, now with clearer intent.)
   */
  silent?: boolean;
}

/**
 * Refreshes the access token using the refresh token (HttpOnly cookie). Returns the new access
 * token, or `null` if the refresh failed.
 *
 * On failure it owns the outcome UX so callers don't double-report:
 *  - **Auth failure** (401/403 from `/auth/refresh` → the refresh token itself was rejected): the
 *    session is dead → hand off to the graceful forced-logout choreography via the bridge.
 *  - **Transient** (network / 429 / 5xx): keep the session (it may recover) and just warn the user.
 *  - **Silent**: neither — used by route guards that redirect themselves.
 */
export async function refreshAccessToken(options: RefreshOptions = {}): Promise<string | null> {
  const { silent = false } = options;

  // Prevent multiple simultaneous refresh requests — piggyback on the in-flight one.
  if (isRefreshing) {
    return new Promise((resolve) => {
      subscribeTokenRefresh((token) => resolve(token));
    });
  }

  isRefreshing = true;

  try {
    const response = await api.post<OzariSuccessResponse>(
      '/auth/refresh',
      {},
      { _isRefreshRequest: true },
    );

    const authHeader = response.headers['authorization'];
    if (!authHeader) throw new Error('No authorization header in refresh response');

    const newToken = authHeader.split(' ')[1];
    if (!newToken) throw new Error('Invalid authorization header format');

    Storage.set(StorageKeys.TOKEN, newToken);

    // The refresh response rotates the CSRF token too — keep our stored copy current.
    const csrfToken = response.headers['x-csrf-token'];
    if (csrfToken) Storage.set(StorageKeys.CSRF, csrfToken);

    // The session recovered — re-arm the forced-logout guard so a *future* death can fire again.
    resetForcedLogout();

    notifyRefreshSubscribers(newToken);
    setupRefreshTimer(newToken);

    return newToken;
  } catch (error) {
    // Release queued requests so they fail fast instead of hanging on a refresh that won't land.
    notifyRefreshSubscribers(null);

    const isAxios = axios.isAxiosError(error);
    const status = isAxios ? getStatus(error) : undefined;
    const authDead = isAxios && isAuthFailure(status);

    if (silent) {
      // Route-guard probe: just report failure; the guard redirects. Drop a dead token.
      if (authDead) clearAuthState();
      return null;
    }

    if (authDead) {
      // Refresh token rejected → session is genuinely dead. The choreography clears state and
      // shows the "session expired" notice, so we don't toast here.
      requestForcedLogout('expired');
    } else {
      // Transient: keep the session (a later request can retry) but tell the user why this failed.
      console.error('Token refresh failed (transient):', error);
      if (isAxios) notify.warning(resolveApiErrorMessage(error));
    }

    return null;
  } finally {
    isRefreshing = false;
  }
}

/**
 * Setup proactive token refresh timer. Refreshes the token 60 seconds before expiration.
 */
export function setupRefreshTimer(token: string): void {
  clearRefreshTimer();

  if (!isTokenValid(token)) return;

  const timeRemaining = getTokenTimeRemaining(token);

  // Refresh 60 seconds before expiration (or immediately if less than 60s remaining).
  const refreshIn = Math.max(0, (timeRemaining - 60) * 1000);

  /* v8 ignore next 3 -- dev-only logging; `import.meta.env.DEV` is false under test */
  if (import.meta.env.DEV) {
    console.log(`[Token Refresh] Timer set for ${Math.floor(refreshIn / 1000)}s from now`);
  }

  refreshTimer = setTimeout(() => {
    /* v8 ignore next -- dev-only logging inside the deferred timer callback */
    if (import.meta.env.DEV) console.log('[Token Refresh] Proactive refresh triggered');
    void refreshAccessToken();
  }, refreshIn);
}

/** Clear the refresh timer. */
export function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Initialize token refresh system. Call this on app startup.
 */
export function initializeTokenRefresh(): void {
  localStorage.removeItem(StorageKeys.TOKEN);
  const token = Storage.get<string>(StorageKeys.TOKEN);

  if (token && isTokenValid(token)) {
    setupRefreshTimer(token);
  }

  // Clear timer on page unload.
  window.addEventListener('beforeunload', clearRefreshTimer);
}

/** Check if currently refreshing token. */
export function getIsRefreshing(): boolean {
  return isRefreshing;
}
