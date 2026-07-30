import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';

/**
 * Permanently deletes an order (`DELETE /orders/:id`, Admin-only — the backend re-checks). There is
 * no undo, which is why the dialog says so before this ever runs.
 *
 * `skipErrorNotification` so the confirm dialog owns its errors. On success the detail entry is
 * dropped (nothing to go back to) and BOTH order lists are invalidated — the row leaves whichever
 * view it was in.
 */
export function useDeleteOrder() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (orderId: number) =>
      api.delete(`/orders/${orderId}`, { skipErrorNotification: true }),
    retry: false,
    onSuccess: (_result, orderId) => {
      queryClient.removeQueries({ queryKey: [QueryKeys.ORDER, orderId] });
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ORDERS] });
    },
  });

  return { deleteOrder: mutation.mutate, isPending: mutation.isPending };
}
