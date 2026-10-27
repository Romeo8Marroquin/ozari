import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { OrderDetailEnvelope } from './order.types';

/**
 * CLEARS an order's deposit settlement (`DELETE /orders/:id/settlement`, Admin-only) — the retained
 * amount, its reason and every lost/broken count go, and the deposit is "por liquidar" again.
 *
 * It moves NO money: a refund already handed back, or a balance already collected, is a real event
 * outside this record, and nothing here reverses it. This is the inverse write and nothing more —
 * the `useUndoPayment` stance.
 *
 * Cache handling mirrors `useUndoPayment` exactly (cancel the polling DASHBOARD before invalidating
 * it, then re-read the agenda and the order).
 */
export function useUndoOrderSettlement() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (orderId: number) =>
      api.delete<OzariSuccessResponse<OrderDetailEnvelope>>(`/orders/${orderId}/settlement`, {
        skipErrorNotification: true,
      }),
    retry: false,
    onSuccess: async (_result, orderId) => {
      await queryClient.cancelQueries({ queryKey: [QueryKeys.DASHBOARD] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.DASHBOARD] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDERS] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDER, orderId] });
    },
  });

  return { undoSettlement: mutation.mutate, isPending: mutation.isPending };
}
