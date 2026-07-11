import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { Product } from './product.types';
import type { CreateProductBody } from './SchemaCreateProduct';

/**
 * Creates a product (`POST /products`, Admin-only — the button never renders for other roles and
 * the backend re-checks with a 403). `skipErrorNotification` so the form owns its errors: backend
 * validation (400) lands inline, ambient failures fall through to a toast (see `ProductForm`).
 * The response is the same role-projected product shape the list returns.
 */
export function useCreateProduct() {
  const mutation = useMutation({
    mutationFn: (body: CreateProductBody) =>
      api.post<OzariSuccessResponse<Product>>('/products', body, { skipErrorNotification: true }),
    retry: false,
  });

  return { createProduct: mutation.mutate, isPending: mutation.isPending };
}
