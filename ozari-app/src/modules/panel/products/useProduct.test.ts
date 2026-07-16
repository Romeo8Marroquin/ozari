import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get } }));

import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { Product } from './product.types';
import { findCachedProduct, useProduct } from './useProduct';

const product = (id: number, name: string): Product => ({
  id,
  name,
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Mesas',
  categoryId: 1,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 75,
  rentTimeUnit: 'Día',
  images: [],
  details: [],
});

const makeClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });

const wrapperFor =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);

/** Prime a cached infinite-list entry the way `useProducts` stores it. */
const primeList = (client: QueryClient, products: Product[], filters: object = {}): void => {
  client.setQueryData([QueryKeys.PRODUCTS, filters], {
    pages: [{ products, pagination: { page: 1, pageSize: 24, total: products.length, totalPages: 1 } }],
    pageParams: [1],
  });
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('findCachedProduct', () => {
  it('finds the product across cached filter combinations and reports the source freshness', () => {
    const client = makeClient();
    primeList(client, [product(1, 'Mesa')], {});
    primeList(client, [product(2, 'Silla')], { q: 'silla' });

    expect(findCachedProduct(client, 2)?.product.name).toBe('Silla');
    expect(findCachedProduct(client, 2)?.updatedAt).toBeGreaterThan(0);
    expect(findCachedProduct(client, 99)).toBeUndefined();
  });

  it('tolerates empty caches, null pages, and dataless query entries', () => {
    const client = makeClient();
    expect(findCachedProduct(client, 1)).toBeUndefined();
    client.setQueryData([QueryKeys.PRODUCTS, {}], { pages: [null], pageParams: [1] });
    expect(findCachedProduct(client, 1)).toBeUndefined();
    // A list query that exists but never resolved (no data yet) is skipped, not crashed on.
    client.getQueryCache().build(client, { queryKey: [QueryKeys.PRODUCTS, { q: 'x' }] });
    expect(findCachedProduct(client, 1)).toBeUndefined();
  });
});

describe('useProduct', () => {
  it('serves INSTANTLY from a cached list page (no fetch while the seed is fresh)', () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    const client = makeClient();
    primeList(client, [product(7, 'Mesa redonda')]);

    const { result } = renderHook(() => useProduct(7), { wrapper: wrapperFor(client) });
    expect(result.current.data?.name).toBe('Mesa redonda');
    expect(get).not.toHaveBeenCalled();
  });

  it('fetches /products/:id on a cold deep-link and unwraps the payload', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    get.mockResolvedValue({ data: { data: { product: product(7, 'Mesa redonda') } } });

    const { result } = renderHook(() => useProduct(7), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/products/7');
    expect(result.current.data?.name).toBe('Mesa redonda');
  });

  it('tolerates an absent payload (null)', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useProduct(7), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('is disabled (never fetches) without a token', () => {
    const { result } = renderHook(() => useProduct(7), { wrapper: wrapperFor(makeClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('never retries a 404 (the product is gone — the answer is final)', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    get.mockRejectedValue({ response: { status: 404 } });
    const { result } = renderHook(() => useProduct(7), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure exactly once', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    get.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useProduct(7), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
