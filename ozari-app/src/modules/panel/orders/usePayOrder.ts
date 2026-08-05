import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { OrderDetailEnvelope } from './order.types';

export interface PayOrderVariables {
  orderId: number;
  /** Optional — cash handed over at the door frequently has no method recorded. */
  paymentMethodId?: number;
}

/**
 * Records an order's payment (`POST /orders/:id/payment`, Admin-only).
 *
 * Payment is its OWN axis, not a lifecycle step (see the endpoint's note), so this is a separate
 * mutation from `useAdvanceOrder` rather than another target status. `skipErrorNotification` because
 * the confirm dialog owns its errors — notably the `409` "this order already has a payment", which
 * means the screen was stale and belongs inline, not in a toast.
 *
 * Cache handling mirrors the advance exactly, including the reason: the DASHBOARD is **cancelled**
 * before it is invalidated, because it polls and an in-flight read issued a moment before the tap
 * would otherwise land after it and paint the unpaid state back.
 */
export function usePayOrder() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ orderId, ...body }: PayOrderVariables) =>
      api.post<OzariSuccessResponse<OrderDetailEnvelope>>(`/orders/${orderId}/payment`, body, {
        skipErrorNotification: true,
      }),
    retry: false,
    onSuccess: async (_result, variables) => {
      await queryClient.cancelQueries({ queryKey: [QueryKeys.DASHBOARD] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.DASHBOARD] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDERS] });
      void queryClient.invalidateQueries({
        queryKey: [QueryKeys.ORDER, variables.orderId],
      });
    },
  });

  return { payOrder: mutation.mutate, isPending: mutation.isPending };
}
