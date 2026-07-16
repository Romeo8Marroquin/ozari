import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

const { requestForcedLogout, resetForcedLogout } = vi.hoisted(() => ({
  requestForcedLogout: vi.fn(),
  resetForcedLogout: vi.fn(),
}));
vi.mock('@utils/sessionLifecycle', () => ({ requestForcedLogout, resetForcedLogout }));

const { warning } = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { warning } }));

import { AxiosError } from 'axios';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from './storage';
import {
  clearAuthState,
  clearRefreshTimer,
  getIsRefreshing,
  initializeTokenRefresh,
  refreshAccessToken,
  setupRefreshTimer,
} from './tokenRefresh';

const base64url = (obj: object): string =>
  btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const futureToken = (): string =>
  `${base64url({ alg: 'HS256' })}.${base64url({ exp: Math.floor(Date.now() / 1000) + 900 })}.sig`;

const axiosError = (status: number): AxiosError =>
  new AxiosError('e', 'C', undefined, undefined, {
    status,
    data: {},
    headers: {},
    statusText: '',
    config: {},
  } as never);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  clearRefreshTimer();
  vi.restoreAllMocks();
});

describe('refreshAccessToken', () => {
  it('success: stores the new token + CSRF, re-arms the guard, returns the token', async () => {
    const token = futureToken();
    post.mockResolvedValue({ headers: { authorization: `Bearer ${token}`, 'x-csrf-token': 'CSRF' } });

    const result = await refreshAccessToken();

    expect(result).toBe(token);
    expect(Storage.get(StorageKeys.TOKEN)).toBe(token);
    expect(Storage.get(StorageKeys.CSRF)).toBe('CSRF');
    expect(resetForcedLogout).toHaveBeenCalled();
  });

  it('auth-dead (double 401): retries once, then triggers the forced logout, no toast', async () => {
    post.mockRejectedValue(axiosError(401));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(post).toHaveBeenCalledTimes(2); // one retry — a dead session 401s twice
    expect(requestForcedLogout).toHaveBeenCalledWith('expired');
    expect(warning).not.toHaveBeenCalled();
  });

  it('recovers when the retry succeeds (the concurrent-tab loser: cookie already rotated)', async () => {
    const token = futureToken();
    post
      .mockRejectedValueOnce(axiosError(401))
      .mockResolvedValueOnce({ headers: { authorization: `Bearer ${token}` } });

    const result = await refreshAccessToken();

    expect(result).toBe(token);
    expect(post).toHaveBeenCalledTimes(2);
    expect(requestForcedLogout).not.toHaveBeenCalled();
    expect(Storage.get(StorageKeys.TOKEN)).toBe(token);
  });

  it('transient (500): warns, keeps the session (no logout, NO retry), returns null', async () => {
    post.mockRejectedValue(axiosError(500));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(post).toHaveBeenCalledTimes(1); // the retry is 401-only
    expect(warning).toHaveBeenCalledTimes(1);
    expect(requestForcedLogout).not.toHaveBeenCalled();
  });

  it('silent + auth-dead: clears auth without the choreography', async () => {
    Storage.set(StorageKeys.TOKEN, 'stale');
    post.mockRejectedValue(axiosError(401));

    const result = await refreshAccessToken({ silent: true });

    expect(result).toBeNull();
    expect(requestForcedLogout).not.toHaveBeenCalled();
    expect(Storage.get(StorageKeys.TOKEN)).toBeNull();
  });

  it('silent + transient: a quiet no-op', async () => {
    post.mockRejectedValue(axiosError(500));

    const result = await refreshAccessToken({ silent: true });

    expect(result).toBeNull();
    expect(warning).not.toHaveBeenCalled();
    expect(requestForcedLogout).not.toHaveBeenCalled();
  });

  it('coalesces a concurrent refresh onto the in-flight one (single round-trip)', async () => {
    const token = futureToken();
    let resolvePost: (v: unknown) => void = () => {};
    post.mockImplementation(() => new Promise((r) => (resolvePost = r)));

    const first = refreshAccessToken();
    const second = refreshAccessToken(); // sees isRefreshing → subscribes instead of re-posting
    resolvePost({ headers: { authorization: `Bearer ${token}` } });

    expect(await Promise.all([first, second])).toEqual([token, token]);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('helpers', () => {
  it('getIsRefreshing is false when idle', () => {
    expect(getIsRefreshing()).toBe(false);
  });

  it('clearAuthState wipes the token + CSRF', () => {
    Storage.set(StorageKeys.TOKEN, 'x');
    Storage.set(StorageKeys.CSRF, 'y');
    clearAuthState();
    expect(Storage.get(StorageKeys.TOKEN)).toBeNull();
    expect(Storage.get(StorageKeys.CSRF)).toBeNull();
  });

  it('setupRefreshTimer schedules for a valid token and no-ops for an invalid one', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    setupRefreshTimer(futureToken());
    expect(setTimeoutSpy).toHaveBeenCalled();
    clearRefreshTimer();

    setTimeoutSpy.mockClear();
    setupRefreshTimer('not-a-jwt'); // invalid → returns early, no schedule
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('initializeTokenRefresh arms the timer for a stored valid token, and not otherwise', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    initializeTokenRefresh(); // no token stored
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    Storage.set(StorageKeys.TOKEN, futureToken());
    initializeTokenRefresh();
    expect(setTimeoutSpy).toHaveBeenCalled();
    clearRefreshTimer();
  });

  it('the scheduled timer proactively refreshes when it fires', async () => {
    vi.useFakeTimers();
    post.mockResolvedValue({ data: { data: {} }, headers: {} });
    // exp ~61s out → refreshIn ≈ 1s, so the timer fires quickly under fake timers.
    const soonToken = `${base64url({ alg: 'HS256' })}.${base64url({ exp: Math.floor(Date.now() / 1000) + 61 })}.sig`;
    setupRefreshTimer(soonToken);

    await vi.advanceTimersByTimeAsync(2000);
    expect(post).toHaveBeenCalled();

    clearRefreshTimer();
    vi.useRealTimers();
  });

  it('treats a malformed authorization header as a failed refresh', async () => {
    Storage.set(StorageKeys.TOKEN, futureToken());
    post.mockResolvedValue({ headers: { authorization: 'Bearer' } }); // no token after the scheme
    await expect(refreshAccessToken()).resolves.toBeNull();
  });
});
