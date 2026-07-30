import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { OrderDetailEnvelope } from './order.types';
import type { CreateOrderBody } from './SchemaCreateOrder';

/**
 * Saves the full edit (`PUT /orders/:id`, Admin-only — the route is admin-gated and the backend
 * re-checks with a 403). The body is the order's FINAL state, the same shape create sends: the API
 * is declarative, so a field left out would be a field cleared, never a field kept.
 *
 * `skipErrorNotification` so the form owns its errors, exactly like create: the 400 validation and
 * the 409 stock/spacing conflict land inline (the 409 additionally carries `data.conflicts`, which
 * the form turns into per-line messages), while ambient failures fall through to a toast.
 */
export function useUpdateOrder() {
  const mutation = useMutation({
    mutationFn: ({ orderId, body }: { orderId: number; body: CreateOrderBody }) =>
      api.put<OzariSuccessResponse<OrderDetailEnvelope>>(`/orders/${orderId}`, body, {
        skipErrorNotification: true,
      }),
    retry: false,
  });

  return { updateOrder: mutation.mutate, isPending: mutation.isPending };
}
