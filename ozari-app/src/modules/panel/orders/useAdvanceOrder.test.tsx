import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post: apiPost } }));

const { invalidateQueries } = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries }),
}));

import { QueryKeys } from '@constants/QueryKeys';
import { createQueryWrapper } from '../../../test/queryWrapper';
import { useAdvanceOrder } from './useAdvanceOrder';

beforeEach(() => vi.clearAllMocks());

describe('useAdvanceOrder', () => {
  it('posts the move to the order and refreshes BOTH order views', async () => {
    apiPost.mockResolvedValue({ data: { data: { order: { id: 12 } } } });
    const { result } = renderHook(() => useAdvanceOrder(), { wrapper: createQueryWrapper() });

    result.current.advanceOrder({
      orderId: 12,
      toStatusId: 3,
      evidenceKeys: ['orders/evidence/a.webp'],
    });

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    // The id rides in the PATH; the body is the move itself. The dialog owns its errors.
    expect(apiPost).toHaveBeenCalledWith(
      '/orders/12/advance',
      { toStatusId: 3, evidenceKeys: ['orders/evidence/a.webp'] },
      { skipErrorNotification: true },
    );
    // An advance can move a row out of the agenda and into the history — invalidate the whole key.
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDERS] }),
    );
  });

  it('does not touch the cache when the move fails', async () => {
    apiPost.mockRejectedValue(new Error('conflict'));
    const { result } = renderHook(() => useAdvanceOrder(), { wrapper: createQueryWrapper() });

    result.current.advanceOrder({ orderId: 12, toStatusId: 2, reason: 'Se canceló la fiesta' });
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
