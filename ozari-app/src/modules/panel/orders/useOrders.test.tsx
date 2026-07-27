import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get } }));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createQueryWrapper } from '../../../test/queryWrapper';
import type { OrderListItem, OrderListResponse } from './order.types';
import { ORDERS_PAGE_SIZE, useOrders } from './useOrders';

const order = (id: number): OrderListItem => ({
  id,
  clientName: `Cliente ${id}`,
  isRegistryClient: false,
  eventType: { id: 1, name: 'Evento familiar' },
  status: { id: 1, name: 'Pendiente' },
  paymentStatus: { id: 1, name: 'Pendiente' },
  deliveryAt: '2026-08-01T14:00:00.000Z',
  isMine: false,
  actions: [],
  itemCount: 1,
  totalAmount: 100,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
});

const pageResponse = (page: number, totalPages: number): { data: { data: OrderListResponse } } => ({
  data: {
    data: {
      orders: [order(page)],
      pagination: { page, pageSize: ORDERS_PAGE_SIZE, total: totalPages, totalPages },
    },
  },
});

beforeEach(() => {
  Storage.set(StorageKeys.TOKEN, 'test-token');
});

afterEach(() => {
  Storage.remove(StorageKeys.TOKEN);
  vi.clearAllMocks();
});

describe('useOrders', () => {
  it('fetches page 1 with the congruent page size and the API view vocabulary', async () => {
    get.mockResolvedValue(pageResponse(1, 1));
    const { result } = renderHook(() => useOrders('agenda'), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/orders', {
      params: { page: 1, pageSize: ORDERS_PAGE_SIZE, view: 'agenda' },
    });
    expect(result.current.data?.orders.map((entry) => entry.id)).toEqual([1]);
  });

  it('maps the historial view to the backend `history`', async () => {
    get.mockResolvedValue(pageResponse(1, 1));
    const { result } = renderHook(() => useOrders('historial'), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/orders', {
      params: expect.objectContaining({ view: 'history' }),
    });
  });

  it('flattens appended pages and surfaces the LATEST pagination meta', async () => {
    get.mockResolvedValueOnce(pageResponse(1, 2)).mockResolvedValueOnce(pageResponse(2, 2));
    const { result } = renderHook(() => useOrders('agenda'), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() =>
      expect(result.current.data?.orders.map((entry) => entry.id)).toEqual([1, 2]),
    );
    expect(get).toHaveBeenLastCalledWith('/orders', {
      params: expect.objectContaining({ page: 2 }),
    });
    expect(result.current.data?.pagination?.page).toBe(2);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('tolerates a payload without data (null page → no orders, no pagination)', async () => {
    get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useOrders('agenda'), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.orders).toEqual([]);
    expect(result.current.data?.pagination).toBeUndefined();
    expect(result.current.hasNextPage).toBe(false);
  });

  it('never fires without a stored access token', () => {
    Storage.remove(StorageKeys.TOKEN);
    renderHook(() => useOrders('agenda'), { wrapper: createQueryWrapper() });
    expect(get).not.toHaveBeenCalled();
  });
});
