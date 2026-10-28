import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { DepositCollectionBody, OrderDetailEnvelope } from './order.types';

export interface RecordDepositCollectionVariables {
  orderId: number;
  body: DepositCollectionBody;
}

/** The same re-read `useSettleOrder` does — including CANCELLING the polling dashboard before it is
 *  invalidated, so a read issued a moment before the write cannot land after it. */
async function rereadAfterWrite(queryClient: QueryClient, orderId: number): Promise<void> {
  await queryClient.cancelQueries({ queryKey: [QueryKeys.DASHBOARD] });
  void queryClient.invalidateQueries({ queryKey: [QueryKeys.DASHBOARD] });
  void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDERS] });
  void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDER, orderId] });
}

/**
 * Records whether the deposit was COLLECTED (`PUT /orders/:id/deposit-collection`, Admin-only):
 * `{ received: true }`, or `{ received: false, reason }` for goods handed over without it. Its own
 * axis like payment and the damage report — never a lifecycle step. `skipErrorNotification` because
 * the dialog owns its errors (`toFormError`: the 400 contract and the 409 "a damage report exists /
 * cancelled" land inline).
 */
export function useRecordDepositCollection() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ orderId, body }: RecordDepositCollectionVariables) =>
      api.put<OzariSuccessResponse<OrderDetailEnvelope>>(
        `/orders/${orderId}/deposit-collection`,
        body,
        { skipErrorNotification: true },
      ),
    retry: false,
    onSuccess: (_result, variables) => rereadAfterWrite(queryClient, variables.orderId),
  });
  return { recordCollection: mutation.mutate, isPending: mutation.isPending };
}

/**
 * Clears the recorded collection back to PENDING (`DELETE /orders/:id/deposit-collection`) — the
 * "Corregir" of a mis-tap. The API refuses (409) while a damage report exists (its money was computed
 * from it — undo the report first) or when nothing is recorded; the dialog shows that inline.
 */
export function useClearDepositCollection() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (orderId: number) =>
      api.delete<OzariSuccessResponse<OrderDetailEnvelope>>(
        `/orders/${orderId}/deposit-collection`,
        { skipErrorNotification: true },
      ),
    retry: false,
    onSuccess: (_result, orderId) => rereadAfterWrite(queryClient, orderId),
  });
  return { clearCollection: mutation.mutate, isPending: mutation.isPending };
}
