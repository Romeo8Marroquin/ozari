import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get } }));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createQueryWrapper } from '../../../test/queryWrapper';
import { PRODUCTS_PAGE_SIZE, useProducts } from './useProducts';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

const page = (n: number, totalPages: number, names: string[]) => ({
  products: names.map((name, index) => ({
    id: n * 100 + index,
    name,
    businessType: 'Alquiler',
    category: 'Mesas',
    currency: {},
    images: [],
    details: [],
  })),
  pagination: { page: n, pageSize: PRODUCTS_PAGE_SIZE, total: totalPages * PRODUCTS_PAGE_SIZE, totalPages },
});

describe('useProducts', () => {
  it('fetches page 1 with the grid page size and flattens the payload', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    get.mockResolvedValue({ data: { data: page(1, 1, ['Mesa']) } });

    const { result } = renderHook(() => useProducts(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/products', {
      params: { page: 1, pageSize: PRODUCTS_PAGE_SIZE },
    });
    expect(result.current.data?.products).toHaveLength(1);
    expect(result.current.data?.pagination).toMatchObject({ page: 1, totalPages: 1 });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('maps the URL filter names to the API query params', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    get.mockResolvedValue({ data: { data: page(1, 1, []) } });

    const { result } = renderHook(
      () => useProducts({ q: 'mesa', categoria: 3, tipo: 1, orden: 'precio-menor' }),
      { wrapper: createQueryWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/products', {
      params: {
        page: 1,
        pageSize: PRODUCTS_PAGE_SIZE,
        search: 'mesa',
        categoryId: 3,
        businessTypeId: 1,
        sort: 'priceAsc',
      },
    });
  });

  it('appends the next page (flattened products, LATEST pagination meta)', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    get
      .mockResolvedValueOnce({ data: { data: page(1, 2, ['Mesa']) } })
      .mockResolvedValueOnce({ data: { data: page(2, 2, ['Silla']) } });

    const { result } = renderHook(() => useProducts(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.products).toHaveLength(2));
    expect(get).toHaveBeenLastCalledWith('/products', {
      params: { page: 2, pageSize: PRODUCTS_PAGE_SIZE },
    });
    expect(result.current.data?.products.map((product) => product.name)).toEqual(['Mesa', 'Silla']);
    expect(result.current.data?.pagination).toMatchObject({ page: 2 });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('is disabled (never fetches) when there is no token', () => {
    const { result } = renderHook(() => useProducts(), { wrapper: createQueryWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('tolerates an absent payload (no products, no next page)', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useProducts(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.products).toEqual([]);
    expect(result.current.data?.pagination).toBeUndefined();
    expect(result.current.hasNextPage).toBe(false);
  });
});
