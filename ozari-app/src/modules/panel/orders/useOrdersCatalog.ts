import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { OrderCatalog } from './order.types';

/**
 * Reads the order reference lookups (`GET /orders/catalog`) the create form renders as selects:
 * event types (with their client lead-times), status vocabularies, contact types, and zones.
 * Seeded data that effectively never changes mid-session → `staleTime: Infinity` (a reload
 * refetches). Gated on a stored token like every panel query.
 */
export function useOrdersCatalog() {
  return useQuery({
    queryKey: [QueryKeys.ORDER_CATALOG],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<OrderCatalog>>('/orders/catalog');
      return response.data.data ?? null;
    },
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
    staleTime: Infinity,
  });
}
