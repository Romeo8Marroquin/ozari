import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { ProductCatalog } from './product.types';

/**
 * Reads the product reference lookups (`GET /products/catalog`) the create/edit form renders as
 * selects. Seeded data that effectively never changes mid-session → `staleTime: Infinity` (a page
 * reload refetches). Gated on a stored token like every panel query.
 *
 * To PREVIEW the form's catalog-error panel in dev: DevTools → Network → right-click the
 * `/products/catalog` request → "Block request URL", then reload (unblock + "Reintentar" to
 * recover) — no code toggle needed.
 */
export function useProductCatalog() {
  return useQuery({
    queryKey: [QueryKeys.PRODUCT_CATALOG],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<ProductCatalog>>('/products/catalog');
      return response.data.data ?? null;
    },
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
    staleTime: Infinity,
  });
}
