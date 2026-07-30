import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { OrderDetailEnvelope } from './order.types';

/**
 * One order (`GET /orders/:id`) — the detail page's source of truth.
 *
 * **Deliberately NOT seeded from the list cache.** The products detail can do that because a grid
 * card carries the same shape as the detail; an agenda ROW does not — it has no lines, no snapshots,
 * no history, no evidence. Seeding it would hand the page a half-order (and did: the first version
 * crashed on `lines.reduce` when arriving from the list, while a refresh worked fine, because only
 * the navigation path had a seed). The page always fetches, and its skeleton mirrors the real
 * layout so the wait is structure, not a blank.
 *
 * Operational data goes stale fast (30s, like the agenda): reopening a detail after a while
 * re-syncs, which matters when two people are moving the same orders. A `404` is final — an unknown
 * id, or a Driver reaching for an order that isn't theirs (the backend answers the same 404 either
 * way, on purpose) — so it isn't retried; the page shows its not-found panel.
 */
export function useOrder(id: number) {
  return useQuery({
    queryKey: [QueryKeys.ORDER, id],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<OrderDetailEnvelope>>(`/orders/${id}`);
      return response.data.data?.order ?? null;
    },
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
    staleTime: 30 * 1000,
    retry: (failureCount, error) => {
      const status = (error as { response?: { status?: number } }).response?.status;
      return status !== 404 && failureCount < 1;
    },
  });
}
