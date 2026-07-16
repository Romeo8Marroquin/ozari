import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { OrderListResponse } from './order.types';
import { toApiView, type OrdersView } from './ordersSearch';

/**
 * How many orders each page fetch asks for (the backend caps at 100). Matches the backend default
 * AND the products grid — 20 everywhere (owner: keep the pagination congruent across sections).
 */
export const ORDERS_PAGE_SIZE = 20;

/**
 * Reads `GET /orders` as an **infinite query**, one cache entry per view (agenda / historial) so
 * switching the segmented control back and forth is instant once each side has loaded. There is
 * deliberately NO `keepPreviousData`: the page swaps views with an exit→enter choreography (the
 * old body is already gone when this hook switches keys), so an uncached view should present as a
 * clean cold load (skeleton), never as the other view's data wearing the wrong label. `select`
 * flattens the pages into one `orders` array and surfaces the LATEST pagination meta.
 *
 * Gated on a stored access token so it never fires on public pages; the axios interceptor attaches
 * auth and owns the 401→refresh round-trip. The agenda is operational data, so it goes stale fast
 * (30s) — a tab refocus after a while re-syncs today's work.
 */
export function useOrders(view: OrdersView) {
  return useInfiniteQuery({
    queryKey: [QueryKeys.ORDERS, view],
    queryFn: async ({ pageParam }) => {
      const response = await api.get<OzariSuccessResponse<OrderListResponse>>('/orders', {
        params: { page: pageParam, pageSize: ORDERS_PAGE_SIZE, view: toApiView(view) },
      });
      return response.data.data ?? null;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const meta = lastPage?.pagination;
      return meta && meta.page < meta.totalPages ? meta.page + 1 : undefined;
    },
    select: (data) => ({
      orders: data.pages.flatMap((page) => page?.orders ?? []),
      pagination: data.pages[data.pages.length - 1]?.pagination,
    }),
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
    staleTime: 30 * 1000,
  });
}
