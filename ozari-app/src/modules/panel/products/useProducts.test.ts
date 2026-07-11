import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get } }));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createQueryWrapper } from '../../../test/queryWrapper';
import { useProducts } from './useProducts';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('useProducts', () => {
  it('fetches /products when a token is present and unwraps the payload', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    const payload = {
      products: [{ id: 1, name: 'Mesa', businessType: 'Alquiler', category: 'Mesas', currency: {}, images: [], details: [] }],
      pagination: { page: 1, pageSize: 15, total: 1, totalPages: 1 },
    };
    get.mockResolvedValue({ data: { data: payload } });

    const { result } = renderHook(() => useProducts(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/products');
    expect(result.current.data).toMatchObject({ pagination: { total: 1 } });
  });

  it('is disabled (never fetches) when there is no token', () => {
    const { result } = renderHook(() => useProducts(), { wrapper: createQueryWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('unwraps to null when the payload is absent', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useProducts(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
