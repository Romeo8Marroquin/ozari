import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';

/**
 * The signed-in person's OWN working preferences — how *I* work, as opposed to the business rules
 * under `/preferences`. Stored server-side so they follow the person to every device. `null` always
 * means the default behaviour.
 */
export interface AccountPreferences {
  /** How the order form fills its billed days: `null` = from the dates (re-derived whenever they
   *  change); N = every new order starts at N days whatever the dates say. Editable per order. */
  orderBilledDays: number | null;
}

interface AccountPreferencesEnvelope {
  preferences: AccountPreferences;
}

/** What a caller reads while the answer is not in yet (or never arrives): the defaults. */
export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = { orderBilledDays: null };

/**
 * `GET /account/preferences` — every role, always the caller's own row. `staleTime: Infinity`: only
 * this person changes them, and their only door seeds the cache with the server's answer. A failure
 * stays SILENT (`skipErrorNotification`) and reads as the defaults — a working preference must never
 * stand between the admin and the order form.
 *
 * User-scoped: it lives in the query cache, which `clearAuthState` clears on sign-out.
 */
export function useAccountPreferences() {
  return useQuery({
    queryKey: [QueryKeys.ACCOUNT_PREFERENCES],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<AccountPreferencesEnvelope>>(
        '/account/preferences',
        { skipErrorNotification: true },
      );
      return response.data.data?.preferences ?? DEFAULT_ACCOUNT_PREFERENCES;
    },
    enabled: Boolean(Storage.get<string>(StorageKeys.TOKEN)),
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * `PUT /account/preferences` — the FULL set (every key; `null` = back to the default). The cache takes
 * the server's answer, not what was sent. `skipErrorNotification`: the settings row owns its errors.
 */
export function useUpdateAccountPreferences() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (preferences: AccountPreferences) =>
      api.put<OzariSuccessResponse<AccountPreferencesEnvelope>>('/account/preferences', preferences, {
        skipErrorNotification: true,
      }),
    onSuccess: (response) => {
      const saved = response.data.data?.preferences;
      if (saved) queryClient.setQueryData([QueryKeys.ACCOUNT_PREFERENCES], saved);
    },
    retry: false,
  });
  return { updatePreferences: mutation.mutate, isPending: mutation.isPending };
}
