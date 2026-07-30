import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiDelete } = vi.hoisted(() => ({ apiDelete: vi.fn() }));
vi.mock('@api/client', () => ({ api: { delete: apiDelete } }));

const { invalidateQueries, removeQueries } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  removeQueries: vi.fn(),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries, removeQueries }),
}));

import { QueryKeys } from '@constants/QueryKeys';
import { createQueryWrapper } from '../../../test/queryWrapper';
import { useDeleteOrder } from './useDeleteOrder';

beforeEach(() => vi.clearAllMocks());

describe('useDeleteOrder', () => {
  it('deletes, drops the detail entry, and refreshes the lists', async () => {
    apiDelete.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useDeleteOrder(), { wrapper: createQueryWrapper() });

    result.current.deleteOrder(12);
    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    // The dialog owns its errors, so the interceptor stays quiet.
    expect(apiDelete).toHaveBeenCalledWith('/orders/12', { skipErrorNotification: true });
    // Nothing to go back to: the detail entry is removed, not merely invalidated.
    await waitFor(() =>
      expect(removeQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDER, 12] }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDERS] });
  });

  it('leaves every cache alone when the delete fails', async () => {
    apiDelete.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDeleteOrder(), { wrapper: createQueryWrapper() });

    result.current.deleteOrder(12);
    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(removeQueries).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
