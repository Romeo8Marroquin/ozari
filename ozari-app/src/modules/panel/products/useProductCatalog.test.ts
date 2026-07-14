import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get } }));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createQueryWrapper } from '../../../test/queryWrapper';
import { useProductCatalog } from './useProductCatalog';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('useProductCatalog', () => {
  it('fetches /products/catalog when a token is present and unwraps the payload', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    const payload = {
      businessTypes: [{ id: 1, name: 'Alquiler' }],
      categories: [{ id: 1, name: 'Mesas' }],
      currencies: [{ id: 1, name: 'Quetzal Guatemalteco', iso4217Code: 'GTQ', symbol: 'Q' }],
      detailTypes: [{ id: 1, name: 'Color' }],
      rentTimeUnits: [{ id: 2, name: 'Día' }],
    };
    get.mockResolvedValue({ data: { data: payload } });

    const { result } = renderHook(() => useProductCatalog(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/products/catalog');
    expect(result.current.data).toMatchObject({ businessTypes: [{ id: 1, name: 'Alquiler' }] });
  });

  it('is disabled (never fetches) when there is no token', () => {
    const { result } = renderHook(() => useProductCatalog(), { wrapper: createQueryWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('unwraps to null when the payload is absent', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useProductCatalog(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

});
