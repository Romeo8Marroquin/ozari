import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { ClientRegistry, ClientRegistryListResponse } from './order.types';

/** How many registries the picker fetches per page — one page covers a micro-business's clients;
 *  the search is client-side (names are encrypted, so there's no server-side query). */
const REGISTRIES_PAGE_SIZE = 100;

/**
 * Reads the admin's walk-in client registries (`GET /client-registries`) for the order form's
 * client picker. Modestly fresh (60s) so a registry just created in the modal shows on return
 * without a hard reload; the mutation also seeds the cache directly. Gated on a stored token.
 */
export function useClientRegistries() {
  return useQuery({
    queryKey: [QueryKeys.CLIENT_REGISTRIES],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<ClientRegistryListResponse>>(
        '/client-registries',
        { params: { page: 1, pageSize: REGISTRIES_PAGE_SIZE } },
      );
      return response.data.data?.registries ?? ([] as ClientRegistry[]);
    },
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
    staleTime: 60 * 1000,
  });
}
