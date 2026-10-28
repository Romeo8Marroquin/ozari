import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiPut, apiDelete } = vi.hoisted(() => ({ apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('@api/client', () => ({ api: { put: apiPut, delete: apiDelete } }));

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
import { useClearDepositCollection, useRecordDepositCollection } from './useDepositCollection';

const expectReread = async () => {
  await waitFor(() =>
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDER, 12] }),
  );
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDERS] });
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.DASHBOARD] });
  // The polling dashboard is cancelled BEFORE it is invalidated.
  expect(cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(
    invalidateQueries.mock.invocationCallOrder[0] ?? 0,
  );
};

beforeEach(() => vi.clearAllMocks());

describe('useRecordDepositCollection', () => {
  it('PUTs the collection (form-owned errors) and re-reads every view that shows it', async () => {
    apiPut.mockResolvedValue({ data: { data: { order: { id: 12 } } } });
    const { result } = renderHook(() => useRecordDepositCollection(), {
      wrapper: createQueryWrapper(),
    });
    result.current.recordCollection({ orderId: 12, body: { received: false, reason: 'Familiar' } });
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(apiPut).toHaveBeenCalledWith(
      '/orders/12/deposit-collection',
      { received: false, reason: 'Familiar' },
      { skipErrorNotification: true },
    );
    await expectReread();
  });

  it('does not touch the cache on a refusal', async () => {
    apiPut.mockRejectedValue(new Error('conflict'));
    const { result } = renderHook(() => useRecordDepositCollection(), {
      wrapper: createQueryWrapper(),
    });
    result.current.recordCollection({ orderId: 12, body: { received: true } });
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

describe('useClearDepositCollection', () => {
  it('DELETEs the record back to pending and re-reads', async () => {
    apiDelete.mockResolvedValue({ data: { data: { order: { id: 12 } } } });
    const { result } = renderHook(() => useClearDepositCollection(), {
      wrapper: createQueryWrapper(),
    });
    result.current.clearCollection(12);
    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(apiDelete).toHaveBeenCalledWith('/orders/12/deposit-collection', {
      skipErrorNotification: true,
    });
    await expectReread();
  });
});
