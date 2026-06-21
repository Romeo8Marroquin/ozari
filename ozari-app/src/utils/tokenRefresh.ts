import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { getTokenTimeRemaining, isTokenValid } from '@utils/jwt';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../types/api.types';

let refreshTimer: NodeJS.Timeout | null = null;
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

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

    // Notify all waiting requests
    notifyRefreshSubscribers(newToken);

    // Setup proactive refresh timer
    setupRefreshTimer(newToken);

    return newToken;
  } catch (error) {
    console.error('Failed to refresh token:', error);

    // ============================================================================
    // 🚨 STATE CLEANUP ON AUTH FAILURE - ADD YOUR STATE MANAGEMENT HERE 🚨
    // ============================================================================
    // When refresh fails, we need to clear ALL application state before redirecting
    // This ensures no stale data remains after logout

    // Clear stored token
    Storage.remove(StorageKeys.TOKEN);

    // Clear refresh timer
    clearRefreshTimer();

    // 🔴 TODO: Add Zustand store resets here when implemented
    // Example: authStore.getState().reset();
    // Example: userStore.getState().clear();

    // 🔴 TODO: Add any other global state resets here
    // - Context API resets
    // - Custom state managers
    // - LocalStorage cleanup (except essentials)
    // - SessionStorage cleanup

    // ============================================================================

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

  console.log(`[Token Refresh] Timer set for ${Math.floor(refreshIn / 1000)}s from now`);

  refreshTimer = setTimeout(async () => {
    console.log('[Token Refresh] Proactive refresh triggered');
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
