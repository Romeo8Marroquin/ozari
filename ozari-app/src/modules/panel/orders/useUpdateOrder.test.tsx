import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiPut } = vi.hoisted(() => ({ apiPut: vi.fn() }));
vi.mock('@api/client', () => ({ api: { put: apiPut } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import type { CreateOrderBody } from './SchemaCreateOrder';
import { useUpdateOrder } from './useUpdateOrder';

const body = {
  clientRegistryId: 3,
  eventTypeId: 1,
  deliveryAt: '2026-08-01T14:00:00.000Z',
  deliveryName: 'María López',
  deliveryContact: 'WhatsApp 5555-1234',
  deliveryAddress: 'Zona 10',
  assignedUserId: 1,
  lines: [{ productId: 3, quantity: 25 }],
} as CreateOrderBody;

beforeEach(() => vi.clearAllMocks());

describe('useUpdateOrder', () => {
  it('PUTs the order\'s FINAL state, letting the form own its errors', async () => {
    apiPut.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useUpdateOrder(), { wrapper: createQueryWrapper() });

    result.current.updateOrder({ orderId: 12, body });
    // The API is declarative — the whole body travels, so a field left out would be one cleared.
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/orders/12', body, { skipErrorNotification: true }),
    );
  });
});
