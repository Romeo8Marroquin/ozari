import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { del } = vi.hoisted(() => ({ del: vi.fn() }));
vi.mock('@api/client', () => ({ api: { delete: del } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import { useDeleteProduct } from './useDeleteProduct';

beforeEach(() => vi.clearAllMocks());

describe('useDeleteProduct', () => {
  it('DELETEs the product with the dialog owning its errors (skipErrorNotification)', async () => {
    del.mockResolvedValue({ data: {} });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useDeleteProduct(), { wrapper: createQueryWrapper() });

    act(() => result.current.deleteProduct(7, { onSuccess }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith('/products/7', { skipErrorNotification: true });
  });

  it('propagates a failure to the caller (no retry — deletion must never auto-replay)', async () => {
    del.mockRejectedValue(new Error('nope'));
    const onError = vi.fn();
    const { result } = renderHook(() => useDeleteProduct(), { wrapper: createQueryWrapper() });

    act(() => result.current.deleteProduct(7, { onError }));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(del).toHaveBeenCalledTimes(1);
  });
});
