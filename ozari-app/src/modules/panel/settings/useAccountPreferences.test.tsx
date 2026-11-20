import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet, apiPut } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get: apiGet, put: apiPut } }));

import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import {
  DEFAULT_ACCOUNT_PREFERENCES,
  useAccountPreferences,
  useUpdateAccountPreferences,
} from './useAccountPreferences';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  Storage.set(StorageKeys.TOKEN, 'token');
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
});

describe('useAccountPreferences', () => {
  it('reads the caller’s own preferences, silently (a failure must never reach the order form)', async () => {
    apiGet.mockResolvedValue({ data: { data: { preferences: { orderBilledDays: 2 } } } });
    const { result } = renderHook(() => useAccountPreferences(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ orderBilledDays: 2 }));
    expect(apiGet).toHaveBeenCalledWith('/account/preferences', { skipErrorNotification: true });
  });

  it('reads an empty answer as the defaults', async () => {
    apiGet.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useAccountPreferences(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(DEFAULT_ACCOUNT_PREFERENCES));
  });
});

describe('useUpdateAccountPreferences', () => {
  it('sends the FULL set and caches the server’s answer, not what was sent', async () => {
    apiPut.mockResolvedValue({ data: { data: { preferences: { orderBilledDays: 3 } } } });
    const { result } = renderHook(() => useUpdateAccountPreferences(), { wrapper });
    act(() => result.current.updatePreferences({ orderBilledDays: 3 }));
    await waitFor(() =>
      expect(client.getQueryData([QueryKeys.ACCOUNT_PREFERENCES])).toEqual({ orderBilledDays: 3 }),
    );
    expect(apiPut).toHaveBeenCalledWith(
      '/account/preferences',
      { orderBilledDays: 3 },
      { skipErrorNotification: true },
    );
  });

  it('leaves the cache alone when the answer carries nothing', async () => {
    client.setQueryData([QueryKeys.ACCOUNT_PREFERENCES], { orderBilledDays: null });
    apiPut.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useUpdateAccountPreferences(), { wrapper });
    const onSuccess = vi.fn();
    act(() => result.current.updatePreferences({ orderBilledDays: 5 }, { onSuccess }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(client.getQueryData([QueryKeys.ACCOUNT_PREFERENCES])).toEqual({ orderBilledDays: null });
  });
});
