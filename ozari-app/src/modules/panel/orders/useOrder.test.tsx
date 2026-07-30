import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get: apiGet } }));

import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { useOrder } from './useOrder';

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

const wrap = (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  Storage.set(StorageKeys.TOKEN, 'token');
});

describe('useOrder', () => {
  it('fetches the FULL detail — it is never seeded from a list row', async () => {
    // A list row has no lines, snapshots, history or evidence; seeding one would hand the page a
    // half-order (which is exactly what once crashed it on navigation while a refresh worked).
    const queryClient = client();
    queryClient.setQueryData([QueryKeys.ORDERS, 'agenda'], {
      pages: [{ orders: [{ id: 12, clientName: 'Cliente 12' }] }],
      pageParams: [1],
    });
    apiGet.mockResolvedValue({ data: { data: { order: { id: 12, lines: [] } } } });

    const { result } = renderHook(() => useOrder(12), { wrapper: wrap(queryClient) });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/orders/12'));
    await waitFor(() => expect(result.current.data?.lines).toEqual([]));
  });

  it('treats a missing envelope as no order', async () => {
    apiGet.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useOrder(99), { wrapper: wrap(client()) });
    await waitFor(() => expect(result.current.data).toBeNull());
  });

  it('never retries a 404 — it is the final answer for missing AND not-yours', async () => {
    apiGet.mockRejectedValue({ response: { status: 404 } });
    const { result } = renderHook(() => useOrder(99), {
      wrapper: wrap(new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure once', async () => {
    apiGet.mockRejectedValue({ response: { status: 500 } });
    const { result } = renderHook(() => useOrder(99), {
      wrapper: wrap(new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })),
    });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('stays disabled without a session token', () => {
    Storage.remove(StorageKeys.TOKEN);
    renderHook(() => useOrder(12), { wrapper: wrap(client()) });
    expect(apiGet).not.toHaveBeenCalled();
  });
});
