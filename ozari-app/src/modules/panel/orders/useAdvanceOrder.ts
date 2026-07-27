import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { OrderDetailEnvelope } from './order.types';

/** The advance body — a TARGET status and whatever that move needs. The client never says which
 *  KIND of move it is: the backend engine derives that (and re-authorises it) under a row lock. */
export interface AdvanceOrderBody {
  toStatusId: number;
  /** R2 keys of photos already uploaded via the presign — required by steps that demand evidence. */
  evidenceKeys?: string[];
  /** Why it's being cancelled — sent on a disruptive move. */
  reason?: string;
}

export interface AdvanceOrderVariables extends AdvanceOrderBody {
  orderId: number;
}

/**
 * Moves an order through its lifecycle (`POST /orders/:id/advance`) — the one mutation behind the
 * agenda's quick action, the admin's rewind and a cancel.
 *
 * `skipErrorNotification` so the confirm dialog owns its errors (`toFormError`): the 409 "it already
 * moved", the 422 "evidence incomplete" and the 403 land inline, while ambient failures fall through
 * to a toast. On success the whole ORDERS cache is invalidated — both views: an advance can move a
 * row out of the agenda and into the history (it finished, or it was cancelled).
 */
export function useAdvanceOrder() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ orderId, ...body }: AdvanceOrderVariables) =>
      api.post<OzariSuccessResponse<OrderDetailEnvelope>>(
        `/orders/${orderId}/advance`,
        body,
        { skipErrorNotification: true },
      ),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDERS] });
    },
  });

  return { advanceOrder: mutation.mutate, isPending: mutation.isPending };
}
