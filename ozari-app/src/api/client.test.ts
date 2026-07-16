import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshAccessToken, subscribeTokenRefresh, getIsRefreshing } = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  subscribeTokenRefresh: vi.fn(),
  getIsRefreshing: vi.fn(() => false),
}));
vi.mock('@utils/tokenRefresh', () => ({ refreshAccessToken, subscribeTokenRefresh, getIsRefreshing }));

const { isForcedLogoutInFlight } = vi.hoisted(() => ({ isForcedLogoutInFlight: vi.fn(() => false) }));
vi.mock('@utils/sessionLifecycle', () => ({ isForcedLogoutInFlight }));

const { reportOutage, isOutageActive } = vi.hoisted(() => ({
  reportOutage: vi.fn(),
  isOutageActive: vi.fn(() => false),
}));
vi.mock('../stores/outageStore', () => ({ reportOutage, isOutageActive }));

const { probeBackendMaybeOutage } = vi.hoisted(() => ({ probeBackendMaybeOutage: vi.fn() }));
vi.mock('@utils/outageProbe', () => ({ probeBackendMaybeOutage }));

const { error, warning } = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { error, warning } }));

const { getOrCreateDeviceUuid } = vi.hoisted(() => ({ getOrCreateDeviceUuid: vi.fn(() => 'device-123') }));
vi.mock('@utils/deviceUuid', () => ({ getOrCreateDeviceUuid }));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { api } from './client';

/** Point the axios instance at a fake adapter; interceptors still run around it. */
const useAdapter = (adapter: AxiosAdapter): void => {
  api.defaults.adapter = adapter;
};
// A fake adapter must enforce validateStatus itself (axios doesn't for custom adapters): resolve 2xx,
// reject non-2xx with a proper AxiosError carrying the response.
const respond = (status: number, data: unknown = {}): AxiosAdapter =>
  async (config) => {
    const response = { data, status, statusText: '', headers: {}, config };
    if (status >= 200 && status < 300) return response;
    return Promise.reject(new AxiosError('failed', 'ERR_BAD_RESPONSE', config, {}, response));
  };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  getIsRefreshing.mockReturnValue(false);
  isForcedLogoutInFlight.mockReturnValue(false);
  isOutageActive.mockReturnValue(false);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('api request interceptor', () => {
  it('attaches device-uuid, CSRF (on non-safe methods), and the auth token', async () => {
    Storage.set(StorageKeys.CSRF, 'csrf-1');
    Storage.set(StorageKeys.TOKEN, 'tok-1');
    let captured: Record<string, unknown> = {};
    useAdapter(async (config) => {
      captured = config.headers as unknown as Record<string, unknown>;
      return { data: {}, status: 200, statusText: '', headers: {}, config };
    });

    await api.post('/x', {}, { deviceUuid: true });

    expect(captured['device-uuid']).toBe('device-123');
    expect(captured['x-csrf-token']).toBe('csrf-1');
    expect(captured.Authorization).toBe('Bearer tok-1');
  });

  it('omits CSRF on GET (safe) and omits auth for public requests', async () => {
    Storage.set(StorageKeys.CSRF, 'csrf-1');
    Storage.set(StorageKeys.TOKEN, 'tok-1');
    let captured: Record<string, unknown> = {};
    useAdapter(async (config) => {
      captured = config.headers as unknown as Record<string, unknown>;
      return { data: {}, status: 200, statusText: '', headers: {}, config };
    });

    await api.get('/x', { public: true });

    expect(captured['x-csrf-token']).toBeUndefined();
    expect(captured.Authorization).toBeUndefined();
  });
});

describe('api response interceptor', () => {
  it('passes successful responses through', async () => {
    useAdapter(respond(200, { ok: true }));
    const res = await api.get('/x', { public: true });
    expect(res.data).toEqual({ ok: true });
  });

  it('notifies on a failed mutation and rejects', async () => {
    useAdapter(respond(500, { message: 'boom' }));
    await expect(api.post('/x', {})).rejects.toBeDefined();
    expect(error).toHaveBeenCalledWith('boom');
  });

  it('toasts a 403 with the backend message (permission denial, even on a read)', async () => {
    useAdapter(respond(403, { message: 'No tienes permiso' }));
    await expect(api.get('/x', { public: true })).rejects.toBeDefined();
    expect(error).toHaveBeenCalledWith('No tienes permiso');
  });

  it('stays silent for a request that opted out (skipErrorNotification)', async () => {
    useAdapter(respond(400, { message: 'bad' }));
    await expect(api.post('/x', {}, { skipErrorNotification: true })).rejects.toBeDefined();
    expect(error).not.toHaveBeenCalled();
  });

  it('401 on a protected request refreshes and retries with the new token', async () => {
    refreshAccessToken.mockResolvedValue('new-tok');
    let calls = 0;
    useAdapter(async (config) => {
      calls += 1;
      const response = { data: { ok: calls === 2 }, status: calls === 1 ? 401 : 200, statusText: '', headers: {}, config };
      if (calls === 1) return Promise.reject(new AxiosError('failed', 'ERR', config, {}, response));
      return response;
    });

    const res = await api.post('/x', {});

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('401 whose refresh fails rejects quietly (the refresh flow owns the outcome)', async () => {
    refreshAccessToken.mockResolvedValue(null);
    useAdapter(respond(401));
    await expect(api.post('/x', {})).rejects.toBeDefined();
    expect(error).not.toHaveBeenCalled();
  });

  it('401 on a public request is not refreshed', async () => {
    useAdapter(respond(401, { message: 'bad creds' }));
    await expect(api.post('/auth/signin', {}, { public: true })).rejects.toBeDefined();
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('a gateway status (503) raises the outage overlay and does not toast', async () => {
    useAdapter(respond(503));
    await expect(api.get('/x', { public: true })).rejects.toBeDefined();
    expect(reportOutage).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('a network error while online triggers the confirming health probe', async () => {
    useAdapter(async (config) => Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config)));
    await expect(api.post('/x', {}, { skipErrorNotification: true })).rejects.toBeDefined();
    expect(probeBackendMaybeOutage).toHaveBeenCalled();
  });

  it('suppresses toasts while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    useAdapter(async (config) => Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config)));
    await expect(api.post('/x', {})).rejects.toBeDefined();
    expect(error).not.toHaveBeenCalled();
  });

  it('suppresses toasts while a forced logout is in flight', async () => {
    isForcedLogoutInFlight.mockReturnValue(true);
    useAdapter(respond(500, { message: 'boom' }));
    await expect(api.post('/x', {})).rejects.toBeDefined();
    expect(error).not.toHaveBeenCalled();
  });

  it('queues a concurrent 401 onto the in-flight refresh, then retries', async () => {
    getIsRefreshing.mockReturnValue(true);
    // The queued request subscribes; simulate the refresh completing with a token.
    subscribeTokenRefresh.mockImplementation((cb: (t: string | null) => void) => cb('queued-tok'));
    let calls = 0;
    useAdapter(async (config) => {
      calls += 1;
      const response = { data: {}, status: calls === 1 ? 401 : 200, statusText: '', headers: {}, config };
      if (calls === 1) return Promise.reject(new AxiosError('failed', 'ERR', config, {}, response));
      return response;
    });

    const res = await api.post('/x', {});
    expect(subscribeTokenRefresh).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('a queued request gives up quietly when the in-flight refresh fails (null)', async () => {
    getIsRefreshing.mockReturnValue(true);
    subscribeTokenRefresh.mockImplementation((cb: (t: string | null) => void) => cb(null));
    useAdapter(respond(401));

    await expect(api.post('/x', {})).rejects.toBeDefined();
    expect(error).not.toHaveBeenCalled();
  });
});
