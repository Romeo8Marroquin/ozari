import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { ProductArrangementResponse } from './product.types';

/**
 * Saves the catalog arrangement (`PUT /products/display-order`, Admin-only) — DECLARATIVE: the body
 * is the FULL ordered list of active product ids, never a "move X to N" step, so two saves can never
 * compose into an order nobody chose. `skipErrorNotification` so the page owns its errors: a `409`
 * (the catalog changed since the page loaded) lands inline with a reload action, ambient failures
 * fall through to a toast. No retry — a 409 must not auto-replay.
 */
export function useSaveProductArrangement() {
  const mutation = useMutation({
    mutationFn: (productIds: number[]) =>
      api.put<OzariSuccessResponse<ProductArrangementResponse>>(
        '/products/display-order',
        { productIds },
        { skipErrorNotification: true },
      ),
    retry: false,
  });

  return { saveArrangement: mutation.mutate, isPending: mutation.isPending };
}
