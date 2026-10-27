import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { put } = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@api/client', () => ({ api: { put } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import { useSaveProductArrangement } from './useSaveProductArrangement';

beforeEach(() => vi.clearAllMocks());

describe('useSaveProductArrangement', () => {
  it('PUTs the FULL ordered id list with the page owning its errors', async () => {
    put.mockResolvedValue({ data: { data: { products: [] } } });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSaveProductArrangement(), { wrapper: createQueryWrapper() });

    act(() => result.current.saveArrangement([3, 1, 2], { onSuccess }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith(
      '/products/display-order',
      { productIds: [3, 1, 2] },
      { skipErrorNotification: true },
    );
  });

  it('never retries (a 409 must not auto-replay)', async () => {
    put.mockRejectedValue(new Error('conflict'));
    const onError = vi.fn();
    const { result } = renderHook(() => useSaveProductArrangement(), { wrapper: createQueryWrapper() });

    act(() => result.current.saveArrangement([1], { onError }));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(put).toHaveBeenCalledTimes(1);
  });
});
