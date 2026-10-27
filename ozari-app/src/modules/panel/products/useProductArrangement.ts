import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { ProductArrangementItem, ProductArrangementResponse } from './product.types';

/**
 * The whole active catalog in its CURRENT display order (`GET /products/display-order`,
 * Admin-only) — the arrange page's server truth. Not paginated on purpose: an arrangement is a
 * full-state edit (the save sends every id), so the page needs every tile at once, and the backend
 * keeps each row tiny.
 *
 * `staleTime: 0` (the default): every visit re-reads, because a product created or deleted since
 * the last visit changes the set the save must match.
 */
export function useProductArrangement() {
  return useQuery({
    queryKey: [QueryKeys.PRODUCT_ARRANGEMENT],
    queryFn: async (): Promise<ProductArrangementItem[]> => {
      const response =
        await api.get<OzariSuccessResponse<ProductArrangementResponse>>('/products/display-order');
      return response.data.data?.products ?? [];
    },
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
  });
}
