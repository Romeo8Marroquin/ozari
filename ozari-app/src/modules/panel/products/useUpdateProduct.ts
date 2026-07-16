import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { Product } from './product.types';
import type { UpdateProductBody } from './SchemaCreateProduct';

/**
 * Updates a product declaratively (`PUT /products/:id`, Admin-only — the edit page never renders
 * for other roles and the backend re-checks with a 403). The body is the product's FULL desired
 * state (the RECONCILE design): scalars + the final detail list + the final gallery; the backend
 * diffs in one transaction. `skipErrorNotification` so the form owns its errors: backend
 * validation (400), not-found (404) and the mid-save concurrency conflict (409) land inline,
 * ambient failures fall through to a toast (see `ProductForm`). The response is the same
 * role-projected product shape the list returns.
 */
export function useUpdateProduct() {
  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateProductBody }) =>
      api.put<OzariSuccessResponse<Product>>(`/products/${id}`, body, {
        skipErrorNotification: true,
      }),
    retry: false,
  });

  return { updateProduct: mutation.mutate, isPending: mutation.isPending };
}
