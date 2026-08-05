import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post: apiPost } }));

const { invalidateQueries, cancelQueries } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  cancelQueries: vi.fn(async () => undefined),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries, cancelQueries }),
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
      evidence: [{ statusId: 3, keys: ['orders/evidence/a.webp'] }],
    });

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    // The id rides in the PATH; the body is the move itself. The dialog owns its errors.
    expect(apiPost).toHaveBeenCalledWith(
      '/orders/12/advance',
      { toStatusId: 3, evidence: [{ statusId: 3, keys: ['orders/evidence/a.webp'] }] },
      { skipErrorNotification: true },
    );
    // An advance can move a row out of the agenda and into the history — invalidate the whole key.
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDERS] }),
    );
    // The DASHBOARD's in-flight read is CANCELLED before it is invalidated: it polls, so a GET
    // issued just before this tap could otherwise land after it and paint the pre-move queue back.
    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.DASHBOARD] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.DASHBOARD] });
    expect(cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateQueries.mock.invocationCallOrder[0] ?? 0,
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

