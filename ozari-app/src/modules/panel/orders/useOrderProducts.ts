import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { Product, ProductListResponse } from '../products/product.types';

/** The order form's product picker fetches the first page at the backend's max size (50). A
 *  micro-business's active catalog fits comfortably; a searchable async picker is the fast-follow
 *  for a larger one. Reuses the products cache key with a distinct params tuple. */
const PICKER_PAGE_SIZE = 50;

/**
 * Reads the product catalog for the order form's line picker (`GET /products?pageSize=50`). The
 * Admin projection carries prices + business type + rent unit — everything the picker needs to
 * filter by mode, flag rentals, and estimate the total. Gated on a stored token; freshness matches
 * the grid (60s) so stock changes propagate reasonably.
 */
export function useOrderProducts() {
  return useQuery({
    queryKey: [QueryKeys.PRODUCTS, 'order-picker'],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<ProductListResponse>>('/products', {
        params: { page: 1, pageSize: PICKER_PAGE_SIZE },
      });
      return response.data.data?.products ?? ([] as Product[]);
    },
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
    staleTime: 60 * 1000,
  });
}
