import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { Storage } from '@utils/storage';
import { StorageKeys } from '@constants/StorageKeys';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type {
  CatalogKey,
  CatalogRowBody,
  CatalogRowEnvelope,
  DeleteCatalogRowResponse,
  PreferenceSetting,
  PreferenceSettingsEnvelope,
  PreferencesResponse,
} from './preference.types';

/**
 * The whole preferences screen in ONE query (`GET /preferences`, Admin-only): the editable settings,
 * every manageable catalog INCLUDING unpublished rows, and the municipalities the zone form picks
 * from. `staleTime: Infinity` — this is configuration the admin edits here and nowhere else, so the
 * only thing that changes it is a mutation on this screen, and every mutation seeds the cache with
 * the server's answer.
 */
export function usePreferences() {
  return useQuery({
    queryKey: [QueryKeys.PREFERENCES],
    queryFn: async () => {
      const response = await api.get<OzariSuccessResponse<PreferencesResponse>>('/preferences');
      return response.data.data ?? null;
    },
    enabled: Boolean(Storage.get(StorageKeys.TOKEN)),
    staleTime: Infinity,
    retry: (failureCount, error) => {
      // A 403 is the final answer (the route already gates non-admins, so this is belt-and-braces).
      const status = (error as { response?: { status?: number } })?.response?.status;
      return status !== 403 && failureCount < 1;
    },
  });
}

/** Patch the cached payload in place — every mutation answers with the server's own version of what
 *  changed, so the screen never has to re-fetch the whole thing to stay honest. */
function usePreferencesCache() {
  const queryClient = useQueryClient();
  return (update: (current: PreferencesResponse) => PreferencesResponse): void => {
    queryClient.setQueryData<PreferencesResponse | null>([QueryKeys.PREFERENCES], (current) =>
      current ? update(current) : current,
    );
  };
}

/**
 * Saves the scalar settings (`PUT /preferences/settings`). The response carries the RELOADED values,
 * so the cache takes those rather than what was sent — a clamped or newly-created value would
 * otherwise show as whatever the form guessed.
 *
 * `skipErrorNotification`: the card owns its errors (the form doctrine).
 */
export function useUpdatePreferenceSettings() {
  const patch = usePreferencesCache();
  const mutation = useMutation({
    mutationFn: (settings: { key: string; value: number | string | boolean }[]) =>
      api.put<OzariSuccessResponse<PreferenceSettingsEnvelope>>(
        '/preferences/settings',
        { settings },
        { skipErrorNotification: true },
      ),
    onSuccess: (response) => {
      const saved = response.data.data?.settings;
      if (saved) patch((current) => ({ ...current, settings: saved }));
    },
    retry: false,
  });
  return { updateSettings: mutation.mutate, isPending: mutation.isPending };
}

/**
 * Every cached query that PROJECTS the seeded reference data these catalogs own.
 *
 * Both are `staleTime: Infinity` — they describe rows only this screen can change — so nothing else
 * would ever refresh them: a detail type added (or deleted) here stayed invisible to the product form
 * until a hard reload, which reads as the app lying about its own configuration.
 *
 * Invalidated as a SET on ANY catalog write rather than mapped per catalog. A map would be one more
 * thing to remember when a catalog is added, and forgetting it brings this bug back silently; two
 * small refetches, on an action only an admin performs, is by far the cheaper mistake. Invalidation
 * (not refetch) is the right verb: a query nobody is watching is merely marked stale and re-reads
 * itself the next time a screen mounts it.
 */
const REFERENCE_DATA_QUERIES: readonly (readonly string[])[] = [
  [QueryKeys.PRODUCT_CATALOG],
  [QueryKeys.ORDER_CATALOG],
];

/** Which response key a catalog's rows live under — the ONE place the url segment and the payload
 *  shape are paired, so a new catalog adds one line here and nothing else. */
export const CATALOG_FIELD: Record<CatalogKey, keyof PreferencesResponse['catalogs']> = {
  'event-types': 'eventTypes',
  'contact-types': 'contactTypes',
  zones: 'zones',
  'payment-methods': 'paymentMethods',
  'product-categories': 'productCategories',
  'product-detail-types': 'productDetailTypes',
  'bank-accounts': 'bankAccounts',
};

/** Rows sorted the way the API returns them: published first, then by name — so a row that was just
 *  unpublished travels to the bottom instead of staying where it was. */
const sortRows = <T extends { name: string; isActive: boolean }>(rows: T[]): T[] =>
  [...rows].sort((a, b) =>
    a.isActive === b.isActive ? a.name.localeCompare(b.name) : Number(b.isActive) - Number(a.isActive),
  );

/**
 * Create / update / delete for ANY catalog — one hook, because the backend is one registry-driven
 * endpoint set. Each mutation patches the cached list from the server's answer, so the screen shows
 * the saved state without a round-trip and without inventing it locally.
 */
export function useCatalogRowMutations(catalog: CatalogKey) {
  const patch = usePreferencesCache();
  const queryClient = useQueryClient();
  const field = CATALOG_FIELD[catalog];

  /**
   * Everything that now describes an older world: the other caches of this reference data (see
   * `REFERENCE_DATA_QUERIES`) and THIS screen.
   *
   * The local patch keeps the UI instant; the re-read makes it true. Re-reading matters because this
   * admin is not necessarily the only one — a second admin may have changed a neighbouring row while
   * this one was working, and a screen that only ever patches its own writes would never find out.
   * It is an invalidation, so an identical answer is visually silent (same rows ⇒ the morph region's
   * key is unchanged ⇒ nothing animates), and a genuinely different one arrives as a normal morph
   * rather than a reload.
   */
  const syncFromServer = (): void => {
    for (const queryKey of [...REFERENCE_DATA_QUERIES, [QueryKeys.PREFERENCES]]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  const create = useMutation({
    mutationFn: (body: CatalogRowBody) =>
      api.post<OzariSuccessResponse<CatalogRowEnvelope>>(
        `/preferences/catalogs/${catalog}`,
        body,
        { skipErrorNotification: true },
      ),
    onSuccess: (response) => {
      const row = response.data.data?.row;
      if (row) patch((current) => ({
        ...current,
        catalogs: { ...current.catalogs, [field]: sortRows([...current.catalogs[field], row]) },
      }));
      syncFromServer();
    },
    retry: false,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: CatalogRowBody }) =>
      api.put<OzariSuccessResponse<CatalogRowEnvelope>>(
        `/preferences/catalogs/${catalog}/${id}`,
        body,
        { skipErrorNotification: true },
      ),
    onSuccess: (response) => {
      const row = response.data.data?.row;
      if (row) patch((current) => ({
        ...current,
        catalogs: {
          ...current.catalogs,
          [field]: sortRows(
            current.catalogs[field].map((existing) => (existing.id === row.id ? row : existing)),
          ),
        },
      }));
      syncFromServer();
    },
    retry: false,
  });

  /**
   * A deletion the server has CONFIRMED, applied to the cached list.
   *
   * Deliberately NOT done in the mutation's own `onSuccess`: the view has to play the row's exit
   * first, and the row cannot animate once it has been removed from the list. So the mutation only
   * reports, and the view calls this when the row has actually finished leaving — which is also why
   * nothing here is optimistic. A row stays on screen until the server agrees it should go.
   */
  const commitDeletion = (id: number, outcome: DeleteCatalogRowResponse['outcome']): void => {
    patch((current) => ({
      ...current,
      catalogs: {
        ...current.catalogs,
        // A DELETED row leaves the list; a DEACTIVATED one stays (unpublished) so the admin can bring
        // it back — and having been hidden rather than removed is proof something references it.
        [field]:
          outcome === 'deleted'
            ? current.catalogs[field].filter((row) => row.id !== id)
            : sortRows(
                current.catalogs[field].map((row) =>
                  row.id === id ? { ...row, isActive: false, isReferenced: true } : row,
                ),
              ),
      },
    }));
    syncFromServer();
  };

  const remove = useMutation({
    mutationFn: (id: number) =>
      api.delete<OzariSuccessResponse<DeleteCatalogRowResponse>>(
        `/preferences/catalogs/${catalog}/${id}`,
        { skipErrorNotification: true },
      ),
    retry: false,
  });

  return {
    createRow: create.mutate,
    updateRow: update.mutate,
    deleteRow: remove.mutate,
    commitDeletion,
    isSaving: create.isPending || update.isPending,
    isDeleting: remove.isPending,
  };
}

/** The settings a card shows, in the order the API listed them, filtered to one group. */
export const settingsInGroup = (
  settings: PreferenceSetting[],
  group: string,
): PreferenceSetting[] => settings.filter((setting) => setting.group === group);

/** One `bool` setting's value out of a settings list, or `fallback` when it is absent or of another
 *  type — the same forgiving read `readLetterhead` does, for the same reason: a screen must not
 *  break because a key it wants has not been published yet. */
export const readBoolSetting = (
  settings: readonly PreferenceSetting[] | undefined,
  key: string,
  fallback: boolean,
): boolean => {
  const found = settings?.find((setting) => setting.key === key);
  return found?.type === 'bool' ? found.value : fallback;
};

/** The create forms that keep a draft — one preference key each, because the answer for one is not
 *  the answer for the other. A new form adds a member here and a key in the API's registry. */
export type DraftForm = 'orders' | 'products';

const DRAFT_SETTING: Record<DraftForm, string> = {
  orders: 'forms.saveDraftOrders',
  products: 'forms.saveDraftProducts',
};

/**
 * Whether THIS create form keeps a silent draft.
 *
 * **Defaults to ON while the query is in flight**, which is deliberate rather than lazy: the
 * preferences answer arrives a moment after the form mounts, and defaulting to OFF would mean a
 * refresh silently discards the draft it was about to restore — the exact loss the feature exists to
 * prevent. Over-saving for a few hundred milliseconds costs a sessionStorage write nobody reads.
 *
 * `isLoading` travels with it so a caller can wait before ACTING on a restore: writing a draft
 * early is harmless, but restoring one the admin has switched off is not.
 */
export function useFormDraftsEnabled(form: DraftForm): { enabled: boolean; isLoading: boolean } {
  const { data, isPending } = usePreferences();
  return {
    enabled: readBoolSetting(data?.settings, DRAFT_SETTING[form], true),
    isLoading: isPending,
  };
}
