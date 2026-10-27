import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { OrderDetailEnvelope, SettleOrderBody } from './order.types';

export interface SettleOrderVariables {
  orderId: number;
  body: SettleOrderBody;
}

/**
 * Records — or CORRECTS — an order's security-deposit settlement (`PUT /orders/:id/settlement`,
 * Admin-only). Declarative: the body is the settlement's final state, so re-sending it is how a
 * mistake is fixed; there is no per-damage endpoint.
 *
 * Like payment, the settlement is its OWN axis rather than a lifecycle step, so it is a separate
 * mutation. `skipErrorNotification` because the settlement page owns its errors (the 400 contract
 * and the 409 "not delivered / cancelled / nothing to settle" land inline).
 *
 * Cache handling mirrors `usePayOrder` exactly, including the reason the DASHBOARD is **cancelled**
 * before it is invalidated: it polls, and a read issued a moment before the save would otherwise land
 * after it and paint the old state back. The agenda re-reads too — its "garantía por liquidar" chip
 * is derived from this record.
 */
export function useSettleOrder() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ orderId, body }: SettleOrderVariables) =>
      api.put<OzariSuccessResponse<OrderDetailEnvelope>>(`/orders/${orderId}/settlement`, body, {
        skipErrorNotification: true,
      }),
    retry: false,
    onSuccess: async (_result, variables) => {
      await queryClient.cancelQueries({ queryKey: [QueryKeys.DASHBOARD] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.DASHBOARD] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDERS] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDER, variables.orderId] });
    },
  });

  return { settleOrder: mutation.mutate, isPending: mutation.isPending };
}
