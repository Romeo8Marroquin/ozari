import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { Product, ProductDetailResponse, ProductListResponse } from './product.types';

/**
 * Scan the cached catalog pages (every filter combination of the infinite list) for `id`. Returns
 * the product AND the source query's `dataUpdatedAt`, so the detail query can inherit the list's
 * freshness instead of pretending cache-seeded data is brand new.
 */
export function findCachedProduct(
  queryClient: QueryClient,
  id: number,
): { product: Product; updatedAt: number } | undefined {
  const entries = queryClient.getQueriesData<InfiniteData<ProductListResponse | null>>({
    queryKey: [QueryKeys.PRODUCTS],
  });
  for (const [queryKey, data] of entries) {
    for (const page of data?.pages ?? []) {
      const product = page?.products.find((candidate) => candidate.id === id);
      if (product) {
        /* v8 ignore next 2 -- a key returned by getQueriesData always has a state; the ?? 0 is a type guard */
        return { product, updatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0 };
      }
    }
  }
  return undefined;
}

/**
 * One product (`GET /products/:id`), role-projected by the backend exactly like a list item.
 *
 * **Seeded from the list cache**: arriving from the catalog grid, the product is already in some
 * cached page — `initialData` serves it instantly (no skeleton, which is also what makes the
 * card→detail image morph seamless) while `initialDataUpdatedAt` keeps the list's freshness so a
 * stale seed still background-refetches. A cold deep-link has no seed and fetches normally.
 *
 * A `404` (unknown/soft-deleted product) surfaces as the query's error state — the page maps it to
 * its not-found panel (reads never toast; the interceptor only notifies mutations).
 */
export function useProduct(id: number) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: [QueryKeys.PRODUCT, id],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<ProductDetailResponse>>(`/products/${id}`);
      return response.data.data?.product ?? null;
    },
    initialData: () => findCachedProduct(queryClient, id)?.product,
    initialDataUpdatedAt: () => findCachedProduct(queryClient, id)?.updatedAt,
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
    staleTime: 60 * 1000,
    // A 404 is a final answer (the product is gone), not a blip — retrying it just delays the
    // not-found panel. Everything else keeps one retry (transient blips recover invisibly).
    retry: (failureCount, error) => {
      const status = (error as { response?: { status?: number } }).response?.status;
      return status !== 404 && failureCount < 1;
    },
  });
}
