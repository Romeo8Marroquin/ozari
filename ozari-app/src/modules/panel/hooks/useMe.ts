import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';

/**
 * The current user's profile, as returned by `GET /auth/me`. The role arrives as the
 * backend enum *name* (see `RolesEnum`), which we localize for display. This is the only
 * source of the user's name on the client — the access token intentionally carries no PII
 * (name/email are encrypted at rest), only `userId`/`userRole`.
 */
export interface MeData {
  id: number;
  email: string;
  fullName: string;
  role: 'Client' | 'Admin' | 'Driver';
  mfaEnabled: boolean;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Reads the current user's profile once and caches it under `QueryKeys.ME`, shared by any
 * consumer (the header pill today, a profile page later). Gated on a stored access token so
 * it doesn't fire on public pages; login invalidates this key so it refetches for the new
 * session. The axios interceptor attaches auth + handles the 401→refresh round-trip.
 */
export function useMe() {
  return useQuery({
    queryKey: [QueryKeys.ME],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<MeData>>('/auth/me');
      return response.data.data ?? null;
    },
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
    staleTime: 5 * 60 * 1000,
  });
}
