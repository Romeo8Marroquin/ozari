import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { ProductListResponse } from './product.types';

/**
 * Reads the catalog from `GET /products` and caches it under `QueryKeys.PRODUCTS`. The response is
 * **role-projected by the backend** (the same endpoint returns fewer fields to a Client than to an
 * Admin), so consumers just render whatever fields arrive — see {@link ProductListResponse}.
 *
 * Gated on a stored access token so it never fires on public pages; the axios interceptor attaches
 * auth and handles the 401→refresh round-trip. A transient/`403` failure is surfaced by the
 * interceptor's toast; the page additionally shows a graceful cold-error state (never a frozen
 * skeleton). Kept intentionally simple (single page) — filters/pagination controls slot in later.
 */
export function useProducts() {
  return useQuery({
    queryKey: [QueryKeys.PRODUCTS],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<ProductListResponse>>('/products');
      return response.data.data ?? null;
    },
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
    staleTime: 60 * 1000,
  });
}
