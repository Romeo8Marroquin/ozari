import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { OrderDetailEnvelope } from './order.types';

/**
 * DELETES an order's payment record (`DELETE /orders/:id/payment`, Admin-only).
 *
 * A hard delete: nothing is kept, so re-recording is simply a new payment with a new date. It exists
 * because recording one is a single irreversible-looking tap offered on three screens and the POST
 * answers `409` on a second attempt — which is right, since re-stamping would overwrite the real
 * payment date — so the state was otherwise unreachable from the UI.
 *
 * It is deliberately NOT a refund: money travelling back to a client is a different event with its
 * own amount, date and method. This is the inverse write, and nothing more.
 *
 * Cache handling mirrors `usePayOrder` exactly, including the reason the DASHBOARD is **cancelled**
 * before it is invalidated: it polls, and a read issued a moment before the tap would otherwise land
 * after it and paint the paid state back — which reads as the app undoing the admin's correction.
 */
export function useUndoPayment() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (orderId: number) =>
      api.delete<OzariSuccessResponse<OrderDetailEnvelope>>(`/orders/${orderId}/payment`, {
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

  return { undoPayment: mutation.mutate, isPending: mutation.isPending };
}
