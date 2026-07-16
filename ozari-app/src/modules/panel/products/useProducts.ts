import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { ProductListResponse } from './product.types';
import { toProductListParams, type ProductListSearch } from './productListSearch';

/**
 * How many products each page fetch asks for (the backend caps at 50). Larger than the backend's
 * default 15 so a typical catalog resolves in one or two fetches; the grid's 2–5 columns mean the
 * only ragged row is the true end of the list, which no page size avoids.
 */
export const PRODUCTS_PAGE_SIZE = 24;

/**
 * Reads the catalog from `GET /products` as an **infinite query** (the grid is a browse-first
 * surface — the sentinel at the bottom appends the next page; no numbered pagination). The response
 * is **role-projected by the backend** (the same endpoint returns fewer fields to a Client than to
 * an Admin), so consumers just render whatever fields arrive — see {@link ProductListResponse}.
 *
 * `filters` (the URL search state) is part of the query key, so each filter combination caches
 * separately; `placeholderData: keepPreviousData` keeps the CURRENT grid on screen while a new
 * filter's first page loads (no skeleton flash — the page dims instead, see `isPlaceholderData`).
 * `select` flattens the pages into one `products` array and surfaces the LATEST pagination meta
 * (`total` drives the count line and `hasNextPage`).
 *
 * Gated on a stored access token so it never fires on public pages; the axios interceptor attaches
 * auth and handles the 401→refresh round-trip. A transient/`403` failure is surfaced by the
 * interceptor's toast; the page additionally shows a graceful cold-error state (never a frozen
 * skeleton).
 */
export function useProducts(filters: ProductListSearch = {}) {
  return useInfiniteQuery({
    queryKey: [QueryKeys.PRODUCTS, filters],
    queryFn: async ({ pageParam }) => {
      const response = await api.get<OzariSuccessResponse<ProductListResponse>>('/products', {
        params: { page: pageParam, pageSize: PRODUCTS_PAGE_SIZE, ...toProductListParams(filters) },
      });
      return response.data.data ?? null;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const meta = lastPage?.pagination;
      return meta && meta.page < meta.totalPages ? meta.page + 1 : undefined;
    },
    select: (data) => ({
      products: data.pages.flatMap((page) => page?.products ?? []),
      pagination: data.pages[data.pages.length - 1]?.pagination,
    }),
    placeholderData: keepPreviousData,
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
    staleTime: 60 * 1000,
  });
}
