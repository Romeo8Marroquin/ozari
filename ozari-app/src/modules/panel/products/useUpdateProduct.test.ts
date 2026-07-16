import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { put } = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@api/client', () => ({ api: { put } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import type { UpdateProductBody } from './SchemaCreateProduct';
import { useUpdateProduct } from './useUpdateProduct';

const body: UpdateProductBody = {
  name: 'Mesa redonda',
  businessTypeId: 1,
  categoryId: 1,
  currencyId: 1,
  quantity: 40,
  rentPrice: 75,
  rentTimeUnitId: 2,
  productDetails: [{ id: 12, detailTypeId: 1, detail: 'Blanco nieve' }],
  images: [
    { id: 11, isPrimary: true },
    { key: 'products/new.webp', isPrimary: false },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe('useUpdateProduct', () => {
  it('PUTs the full desired state with the form owning its errors (skipErrorNotification)', async () => {
    put.mockResolvedValue({ data: { data: { id: 7 } } });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useUpdateProduct(), { wrapper: createQueryWrapper() });

    act(() => result.current.updateProduct({ id: 7, body }, { onSuccess }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith('/products/7', body, { skipErrorNotification: true });
  });

  it('propagates a failure to the caller (no retry — a 409 must not auto-replay)', async () => {
    put.mockRejectedValue(new Error('conflict'));
    const onError = vi.fn();
    const { result } = renderHook(() => useUpdateProduct(), { wrapper: createQueryWrapper() });

    act(() => result.current.updateProduct({ id: 7, body }, { onError }));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(put).toHaveBeenCalledTimes(1);
  });
});
