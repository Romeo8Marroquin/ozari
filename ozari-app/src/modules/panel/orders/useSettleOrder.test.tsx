import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiPut } = vi.hoisted(() => ({ apiPut: vi.fn() }));
vi.mock('@api/client', () => ({ api: { put: apiPut } }));

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
import { useSettleOrder } from './useSettleOrder';

beforeEach(() => vi.clearAllMocks());

const body = { retainedAmount: 50, retainedReason: 'Mantel manchado', damages: [{ lineId: 31, quantity: 1 }] };

describe('useSettleOrder', () => {
  it('PUTs the settlement\'s final state and refreshes every view that shows it', async () => {
    apiPut.mockResolvedValue({ data: { data: { order: { id: 12 } } } });
    const { result } = renderHook(() => useSettleOrder(), { wrapper: createQueryWrapper() });

    result.current.settleOrder({ orderId: 12, body });

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    // The page owns its errors (400/409 inline), so the interceptor stays quiet.
    expect(apiPut).toHaveBeenCalledWith('/orders/12/settlement', body, {
      skipErrorNotification: true,
    });
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDER, 12] }),
    );
    // The agenda's "garantía por liquidar" chip is derived from this record.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDERS] });
    // The polling dashboard is cancelled BEFORE it is invalidated (the payment hooks' race).
    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.DASHBOARD] });
    expect(cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateQueries.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('does not touch the cache when the API refuses the settlement', async () => {
    apiPut.mockRejectedValue(new Error('conflict'));
    const { result } = renderHook(() => useSettleOrder(), { wrapper: createQueryWrapper() });

    result.current.settleOrder({ orderId: 12, body });
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
