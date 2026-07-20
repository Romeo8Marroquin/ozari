import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { OrderDetailEnvelope } from './order.types';
import type { CreateOrderBody } from './SchemaCreateOrder';

/**
 * Creates an order (`POST /orders`, Admin-only — the page is admin-gated and the backend re-checks
 * with a 403). `skipErrorNotification` so the form owns its errors: the 400 validation and the 409
 * stock/spacing conflict land inline (the 409 additionally carries `data.conflicts`, which the form
 * turns into a per-line message), while ambient failures fall through to a toast (see `OrderForm`).
 */
export function useCreateOrder() {
  const mutation = useMutation({
    mutationFn: (body: CreateOrderBody) =>
      api.post<OzariSuccessResponse<OrderDetailEnvelope>>('/orders', body, {
        skipErrorNotification: true,
      }),
    retry: false,
  });

  return { createOrder: mutation.mutate, isPending: mutation.isPending };
}
