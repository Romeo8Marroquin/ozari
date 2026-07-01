import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { getTokenTimeRemaining, isTokenValid } from '@utils/jwt';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../types/api.types';

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

/**
 * Tears down all client-side auth state. Called both when a refresh fails and on an explicit
 * sign-out, so "you are no longer logged in" is cleaned up in exactly one place.
 *
 * NOTE: intentionally does NOT redirect or clear the React Query cache — those are the caller's
 * concern (a refresh failure uses a hard `location.replace`; sign-out navigates via the router
 * and clears the query cache). Keep global-store resets here as they come online.
 */
export function clearAuthState(): void {
  Storage.remove(StorageKeys.TOKEN);
  Storage.remove(StorageKeys.CSRF);
  clearRefreshTimer();

  // 🔴 TODO: reset Zustand stores here when implemented (authStore/userStore .reset()).
}

/**
 * Subscribe to token refresh completion
 * Used by failed requests to retry after refresh
 */
export function subscribeTokenRefresh(callback: (token: string) => void): void {
  refreshSubscribers.push(callback);
}

/**
 * Notify all subscribers that token has been refreshed
 */
function notifyRefreshSubscribers(token: string): void {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
}

/**
 * Refreshes the access token using the refresh token (stored in HttpOnly cookie)
 * @returns New access token or null if refresh failed
 */
export async function refreshAccessToken(redirectOnFailure = true): Promise<string | null> {
  // Prevent multiple simultaneous refresh requests
  if (isRefreshing) {
    return new Promise((resolve) => {
      subscribeTokenRefresh((token) => {
        resolve(token);
      });
    });
  }

  isRefreshing = true;

  try {
    const response = await api.post<OzariSuccessResponse>(
      '/auth/refresh',
      {},
      {
        _isRefreshRequest: true,
      }
    );

    // Extract new access token from Authorization header
    const authHeader = response.headers['authorization'];
    if (!authHeader) {
      throw new Error('No authorization header in refresh response');
    }

    const newToken = authHeader.split(' ')[1];
    if (!newToken) {
      throw new Error('Invalid authorization header format');
    }

    // Store new token
    Storage.set(StorageKeys.TOKEN, newToken);

    // The refresh response rotates the CSRF token too — keep our stored copy current.
    const csrfToken = response.headers['x-csrf-token'];
    if (csrfToken) Storage.set(StorageKeys.CSRF, csrfToken);

    // Notify all waiting requests
    notifyRefreshSubscribers(newToken);

    // Setup proactive refresh timer
    setupRefreshTimer(newToken);

    return newToken;
  } catch (error) {
    console.error('Failed to refresh token:', error);

    // Clear ALL client-side auth state before redirecting so no stale data survives.
    clearAuthState();

    if (redirectOnFailure) {
      window.location.replace('/sesion/inicio');
    }

    return null;
  } finally {
    isRefreshing = false;
  }
}

/**
 * Setup proactive token refresh timer
 * Refreshes token 60 seconds before expiration
 */
export function setupRefreshTimer(token: string): void {
  clearRefreshTimer();

  if (!isTokenValid(token)) {
    return;
  }

  const timeRemaining = getTokenTimeRemaining(token);

  // Refresh 60 seconds before expiration (or immediately if less than 60s remaining)
  const refreshIn = Math.max(0, (timeRemaining - 60) * 1000);

  if (import.meta.env.DEV) {
    console.log(`[Token Refresh] Timer set for ${Math.floor(refreshIn / 1000)}s from now`);
  }

  refreshTimer = setTimeout(async () => {
    if (import.meta.env.DEV) {
      console.log('[Token Refresh] Proactive refresh triggered');
    }
    await refreshAccessToken();
  }, refreshIn);
}

/**
 * Clear the refresh timer
 */
export function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Initialize token refresh system
 * Call this on app startup
 */
export function initializeTokenRefresh(): void {
  localStorage.removeItem(StorageKeys.TOKEN);
  const token = Storage.get<string>(StorageKeys.TOKEN);

  if (token && isTokenValid(token)) {
    setupRefreshTimer(token);
  }

  // Clear timer on page unload
  window.addEventListener('beforeunload', clearRefreshTimer);
}

/**
 * Check if currently refreshing token
 */
export function getIsRefreshing(): boolean {
  return isRefreshing;
}
