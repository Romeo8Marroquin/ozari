import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get, post, put } }));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createQueryWrapper } from '../../../test/queryWrapper';
import { useOrdersCatalog } from './useOrdersCatalog';
import { useClientRegistries } from './useClientRegistries';
import { useOrderProducts } from './useOrderProducts';
import { useCreateOrder } from './useCreateOrder';
import { useCreateClientRegistry } from './useCreateClientRegistry';
import { useUpdateClientRegistry } from './useUpdateClientRegistry';
import { usePayOrder } from './usePayOrder';

beforeEach(() => {
  Storage.set(StorageKeys.TOKEN, 'test-token');
});
afterEach(() => {
  Storage.remove(StorageKeys.TOKEN);
  vi.clearAllMocks();
});

describe('useOrdersCatalog', () => {
  it('fetches the order catalog and unwraps it', async () => {
    const catalog = { eventTypes: [], serviceStatuses: [], paymentStatuses: [], contactTypes: [], zones: [] };
    get.mockResolvedValue({ data: { data: catalog } });
    const { result } = renderHook(() => useOrdersCatalog(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/orders/catalog');
    expect(result.current.data).toBe(catalog);
  });

  it('tolerates a null payload', async () => {
    get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useOrdersCatalog(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('does not fire without a token', () => {
    Storage.remove(StorageKeys.TOKEN);
    renderHook(() => useOrdersCatalog(), { wrapper: createQueryWrapper() });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('useClientRegistries', () => {
  it('fetches the first page and returns the registries array', async () => {
    const registries = [{ id: 3, name: 'María', contacts: [], addresses: [], createdAt: 'x' }];
    get.mockResolvedValue({ data: { data: { registries, pagination: {} } } });
    const { result } = renderHook(() => useClientRegistries(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/client-registries', { params: { page: 1, pageSize: 100 } });
    expect(result.current.data).toBe(registries);
  });

  it('defaults to an empty array on a null payload', async () => {
    get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useClientRegistries(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useOrderProducts', () => {
  it('fetches page 1 at the max size and returns the products', async () => {
    const products = [{ id: 3, name: 'Silla' }];
    get.mockResolvedValue({ data: { data: { products, pagination: {} } } });
    const { result } = renderHook(() => useOrderProducts(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/products', { params: { page: 1, pageSize: 50 } });
    expect(result.current.data).toBe(products);
  });

  it('defaults to an empty array on a null payload', async () => {
    get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useOrderProducts(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useCreateOrder', () => {
  it('posts the body with skipErrorNotification', async () => {
    post.mockResolvedValue({ data: { data: { order: { id: 12 } } } });
    const { result } = renderHook(() => useCreateOrder(), { wrapper: createQueryWrapper() });
    const body = { clientRegistryId: 3, eventTypeId: 1, deliveryAt: 'x', deliveryName: 'a', deliveryContact: 'b', deliveryAddress: 'ccccc', assignedUserId: 1, lines: [] };
    result.current.createOrder(body);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/orders', body, { skipErrorNotification: true });
  });
});

describe('useCreateClientRegistry', () => {
  it('posts the body with skipErrorNotification', async () => {
    post.mockResolvedValue({ data: { data: { registry: { id: 3 } } } });
    const { result } = renderHook(() => useCreateClientRegistry(), { wrapper: createQueryWrapper() });
    const body = { name: 'María', contacts: [], addresses: [] };
    result.current.createRegistry(body);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/client-registries', body, { skipErrorNotification: true });
  });
});

describe('usePayOrder', () => {
  it('posts to the order’s payment door with skipErrorNotification', async () => {
    post.mockResolvedValue({ data: { data: { order: { id: 12 } } } });
    const { result } = renderHook(() => usePayOrder(), { wrapper: createQueryWrapper() });
    result.current.payOrder({ orderId: 12, paymentMethodId: 2 });
    await waitFor(() => expect(post).toHaveBeenCalled());
    // The id rides in the PATH; the body is only the optional method.
    expect(post).toHaveBeenCalledWith(
      '/orders/12/payment',
      { paymentMethodId: 2 },
      { skipErrorNotification: true },
    );
  });

  it('sends an empty body when no method was chosen', async () => {
    post.mockResolvedValue({ data: { data: { order: { id: 12 } } } });
    const { result } = renderHook(() => usePayOrder(), { wrapper: createQueryWrapper() });
    result.current.payOrder({ orderId: 12 });
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/orders/12/payment', {}, { skipErrorNotification: true });
  });
});

describe('useUpdateClientRegistry', () => {
  it('puts the SAME body shape at the row’s url, with skipErrorNotification', async () => {
    put.mockResolvedValue({ data: { data: { registry: { id: 3 } } } });
    const { result } = renderHook(() => useUpdateClientRegistry(), { wrapper: createQueryWrapper() });
    const body = { name: 'María', contacts: [], addresses: [] };
    result.current.updateRegistry({ id: 3, body });
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith('/client-registries/3', body, { skipErrorNotification: true });
  });
});
