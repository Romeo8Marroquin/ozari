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
import { useUndoPayment } from './useUndoPayment';

beforeEach(() => vi.clearAllMocks());

describe('useUndoPayment', () => {
  it('deletes the payment and refreshes every view that shows it', async () => {
    apiDelete.mockResolvedValue({ data: { data: { order: { id: 12 } } } });
    const { result } = renderHook(() => useUndoPayment(), { wrapper: createQueryWrapper() });

    result.current.undoPayment(12);

    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    // The act carries no options at all: it deletes our own record and nothing else.
    expect(apiDelete).toHaveBeenCalledWith('/orders/12/payment', {
      skipErrorNotification: true,
    });
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDER, 12] }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDERS] });
    // Same race as every other order mutation: the DASHBOARD polls, so a read issued just before
    // this tap would otherwise land after it and paint the paid state back — which reads as the app
    // undoing the admin's correction. Cancel, THEN invalidate.
    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.DASHBOARD] });
    expect(cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateQueries.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('does not touch the cache when the order had no payment to undo', async () => {
    apiDelete.mockRejectedValue(new Error('conflict'));
    const { result } = renderHook(() => useUndoPayment(), { wrapper: createQueryWrapper() });

    result.current.undoPayment(12);
    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
