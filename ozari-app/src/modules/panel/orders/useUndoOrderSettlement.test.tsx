import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiDelete } = vi.hoisted(() => ({ apiDelete: vi.fn() }));
vi.mock('@api/client', () => ({ api: { delete: apiDelete } }));

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
import { useUndoOrderSettlement } from './useUndoOrderSettlement';

beforeEach(() => vi.clearAllMocks());

describe('useUndoOrderSettlement', () => {
  it('clears the settlement and refreshes every view that shows it', async () => {
    apiDelete.mockResolvedValue({ data: { data: { order: { id: 12 } } } });
    const { result } = renderHook(() => useUndoOrderSettlement(), { wrapper: createQueryWrapper() });

    result.current.undoSettlement(12);

    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    // The act carries no options: it clears our own record and moves nothing.
    expect(apiDelete).toHaveBeenCalledWith('/orders/12/settlement', {
      skipErrorNotification: true,
    });
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDER, 12] }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDERS] });
    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.DASHBOARD] });
    expect(cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateQueries.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('does not touch the cache when there was no settlement to undo', async () => {
    apiDelete.mockRejectedValue(new Error('conflict'));
    const { result } = renderHook(() => useUndoOrderSettlement(), { wrapper: createQueryWrapper() });

    result.current.undoSettlement(12);
    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
