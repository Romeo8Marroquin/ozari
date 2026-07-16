import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';

/**
 * Deletes a product (`DELETE /products/:id`, Admin-only — the button never renders for other roles
 * and the backend re-checks with a 403). The backend applies the NO-TRASH policy: the row
 * tombstones only when order history references it, hard-deletes otherwise, and the gallery's R2
 * objects are swept either way. `skipErrorNotification` so the confirm dialog owns its errors:
 * inline-class failures land in the dialog, ambient ones toast (see `ProductDeleteModal`).
 */
export function useDeleteProduct() {
  const mutation = useMutation({
    mutationFn: (id: number) =>
      api.delete<OzariSuccessResponse<undefined>>(`/products/${id}`, {
        skipErrorNotification: true,
      }),
    retry: false,
  });

  return { deleteProduct: mutation.mutate, isPending: mutation.isPending };
}
