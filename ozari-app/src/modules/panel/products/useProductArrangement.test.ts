import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get } }));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createQueryWrapper } from '../../../test/queryWrapper';
import { useProductArrangement } from './useProductArrangement';

beforeEach(() => {
  vi.clearAllMocks();
  Storage.set(StorageKeys.TOKEN, 'token');
});

describe('useProductArrangement', () => {
  it('reads the whole active catalog in display order', async () => {
    const products = [{ id: 1, name: 'Mesa', category: 'Mesas', businessType: 'Alquiler', placed: true }];
    get.mockResolvedValue({ data: { data: { products } } });
    const { result } = renderHook(() => useProductArrangement(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(products));
    expect(get).toHaveBeenCalledWith('/products/display-order');
  });

  it('reads an envelope without data as an empty catalog', async () => {
    get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useProductArrangement(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});
