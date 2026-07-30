import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet, apiPut, apiPost, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));
vi.mock('@api/client', () => ({
  api: { get: apiGet, put: apiPut, post: apiPost, delete: apiDelete },
}));

import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { useProductCatalog } from '../products/useProductCatalog';
import type { PreferencesResponse } from './preference.types';
import {
  CATALOG_FIELD,
  settingsInGroup,
  useCatalogRowMutations,
  usePreferences,
  useUpdatePreferenceSettings,
} from './usePreferences';

const payload = (): PreferencesResponse => ({
  settings: [
    { key: 'orders.logisticsSpacingMinutes', type: 'int', value: 60, min: 1, max: 1440, group: 'orders' },
    { key: 'orders.evidenceMinPhotos', type: 'int', value: 1, min: 1, max: 20, group: 'evidence' },
  ],
  catalogs: {
    eventTypes: [{ id: 1, name: 'Boda', isActive: true, minLeadHours: 24, isReferenced: false }],
    contactTypes: [],
    zones: [],
    paymentMethods: [],
    productCategories: [],
    productDetailTypes: [],
  },
  municipalities: [{ id: 4, name: 'Mixco', isActive: true }],
});

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  Storage.set(StorageKeys.TOKEN, 'token');
  // `gcTime: Infinity` on purpose: the mutation hooks patch the cache without OBSERVING the query,
  // and with a zero gc time React Query collects an unobserved entry immediately — the assertions
  // would read `undefined` and look like the patch never happened.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData([QueryKeys.PREFERENCES], payload());
});

describe('usePreferences', () => {
  it('fetches the whole screen in one call', async () => {
    client.clear();
    apiGet.mockResolvedValue({ data: { data: payload() } });
    const { result } = renderHook(() => usePreferences(), { wrapper });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/preferences'));
    await waitFor(() => expect(result.current.data?.settings).toHaveLength(2));
  });

  it('treats a missing envelope as no data', async () => {
    client.clear();
    apiGet.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => usePreferences(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeNull());
  });

  it('never retries a 403 — the route already gates non-admins', async () => {
    client.clear();
    apiGet.mockRejectedValue({ response: { status: 403 } });
    const retrying = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
    const { result } = renderHook(() => usePreferences(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={retrying}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure once', async () => {
    client.clear();
    apiGet.mockRejectedValue({ response: { status: 500 } });
    const retrying = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
    const { result } = renderHook(() => usePreferences(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={retrying}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('stays disabled without a session token', () => {
    client.clear();
    Storage.remove(StorageKeys.TOKEN);
    renderHook(() => usePreferences(), { wrapper });
    expect(apiGet).not.toHaveBeenCalled();
  });
});

describe('useUpdatePreferenceSettings', () => {
  it('takes the RELOADED values from the response, not what was sent', async () => {
    // The server clamps and upserts, so echoing the request would show a value the system will not
    // actually read.
    apiPut.mockResolvedValue({
      data: { data: { settings: [{ key: 'orders.logisticsSpacingMinutes', type: 'int', value: 90, min: 1, max: 1440, group: 'orders' }] } },
    });
    const { result } = renderHook(() => useUpdatePreferenceSettings(), { wrapper });
    result.current.updateSettings([{ key: 'orders.logisticsSpacingMinutes', value: 999999 }]);

    await waitFor(() =>
      expect(
        client.getQueryData<PreferencesResponse>([QueryKeys.PREFERENCES])?.settings[0]?.value,
      ).toBe(90),
    );
    expect(apiPut).toHaveBeenCalledWith(
      '/preferences/settings',
      { settings: [{ key: 'orders.logisticsSpacingMinutes', value: 999999 }] },
      { skipErrorNotification: true },
    );
  });

  it('leaves the cache alone when the response carries no settings', async () => {
    apiPut.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useUpdatePreferenceSettings(), { wrapper });
    result.current.updateSettings([{ key: 'orders.logisticsSpacingMinutes', value: 90 }]);
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(
      client.getQueryData<PreferencesResponse>([QueryKeys.PREFERENCES])?.settings[0]?.value,
    ).toBe(60);
  });

  it('does nothing when there is no cached payload to patch', async () => {
    client.clear();
    apiPut.mockResolvedValue({
      data: { data: { settings: [{ key: 'x', type: 'int', value: 1, min: 0, max: 2, group: 'orders' }] } },
    });
    const { result } = renderHook(() => useUpdatePreferenceSettings(), { wrapper });
    result.current.updateSettings([{ key: 'orders.logisticsSpacingMinutes', value: 90 }]);
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(client.getQueryData([QueryKeys.PREFERENCES])).toBeUndefined();
  });
});

describe('useCatalogRowMutations', () => {
  const rowsNow = () =>
    client.getQueryData<PreferencesResponse>([QueryKeys.PREFERENCES])?.catalogs.eventTypes ?? [];

  it('pairs every catalog url segment with its payload field', () => {
    expect(CATALOG_FIELD).toEqual({
      'event-types': 'eventTypes',
      'contact-types': 'contactTypes',
      zones: 'zones',
      'payment-methods': 'paymentMethods',
      'product-categories': 'productCategories',
      'product-detail-types': 'productDetailTypes',
    });
  });

  it('adds the created row, keeping published-first / by-name order', async () => {
    apiPost.mockResolvedValue({ data: { data: { row: { id: 2, name: 'Aniversario', isActive: true } } } });
    const { result } = renderHook(() => useCatalogRowMutations('event-types'), { wrapper });
    result.current.createRow({ name: 'Aniversario', isActive: true });

    await waitFor(() => expect(rowsNow()).toHaveLength(2));
    // Sorted, not appended: "Aniversario" comes before "Boda".
    expect(rowsNow().map((row) => row.name)).toEqual(['Aniversario', 'Boda']);
    expect(apiPost).toHaveBeenCalledWith(
      '/preferences/catalogs/event-types',
      { name: 'Aniversario', isActive: true },
      { skipErrorNotification: true },
    );
  });

  it('replaces the updated row, and an unpublished one travels to the bottom', async () => {
    client.setQueryData([QueryKeys.PREFERENCES], {
      ...payload(),
      catalogs: {
        ...payload().catalogs,
        eventTypes: [
          { id: 1, name: 'Boda', isActive: true },
          { id: 2, name: 'Otro', isActive: true },
        ],
      },
    });
    apiPut.mockResolvedValue({ data: { data: { row: { id: 1, name: 'Boda', isActive: false } } } });
    const { result } = renderHook(() => useCatalogRowMutations('event-types'), { wrapper });
    result.current.updateRow({ id: 1, body: { name: 'Boda', isActive: false } });

    await waitFor(() => expect(rowsNow()[0]?.name).toBe('Otro'));
    expect(rowsNow().map((row) => row.isActive)).toEqual([true, false]);
  });

  it('does NOT touch the list on its own — the delete only reports', async () => {
    // Nothing here is optimistic: the row has to survive until the server confirms AND until the view
    // has played its exit, so the mutation reports and `commitDeletion` is what edits the list.
    apiDelete.mockResolvedValue({ data: { data: { outcome: 'deleted' } } });
    const { result } = renderHook(() => useCatalogRowMutations('event-types'), { wrapper });
    result.current.deleteRow(1);
    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(rowsNow()).toHaveLength(1);
  });

  it('REMOVES a deleted row but KEEPS a deactivated one, unpublished', async () => {
    // The outcome drives the cache exactly as it drives the copy: a row that only got hidden must
    // stay visible so the admin can bring it back.
    const { result, rerender } = renderHook(() => useCatalogRowMutations('event-types'), { wrapper });
    result.current.commitDeletion(1, 'deleted');
    await waitFor(() => expect(rowsNow()).toHaveLength(0));

    // Two rows now, so the patch has to leave the OTHER one exactly as it was.
    client.setQueryData([QueryKeys.PREFERENCES], {
      ...payload(),
      catalogs: {
        ...payload().catalogs,
        eventTypes: [
          { id: 1, name: 'Boda', isActive: true },
          { id: 2, name: 'Aniversario', isActive: true },
        ],
      },
    });
    rerender();
    result.current.commitDeletion(1, 'deactivated');
    // Unpublished rows sort to the bottom, so "Boda" travels below the untouched "Aniversario".
    await waitFor(() => expect(rowsNow()[1]?.isActive).toBe(false));
    expect(rowsNow().map((row) => row.name)).toEqual(['Aniversario', 'Boda']);
    // Being HIDDEN rather than removed is proof something references it — recording that keeps the
    // next delete dialog truthful instead of promising a removal that cannot happen.
    expect(rowsNow()[1]?.isReferenced).toBe(true);
  });

  it('re-reads the server through EVERY door — this screen and the other caches', async () => {
    // The product/order catalogs are `staleTime: Infinity`, so nothing else would ever refresh them:
    // a detail type added here stayed invisible to the product form until a hard reload. THIS screen
    // is re-read too, because a second admin may have changed a neighbouring row. Invalidating (not
    // refetching) is the right verb — an unwatched query just re-reads itself on its next mount.
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const staleAfter = (): unknown[][] =>
      invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    const EVERY_CACHE = [
      [QueryKeys.PRODUCT_CATALOG],
      [QueryKeys.ORDER_CATALOG],
      [QueryKeys.PREFERENCES],
    ];

    apiPost.mockResolvedValue({ data: { data: { row: { id: 2, name: 'Otro', isActive: true } } } });
    const { result } = renderHook(() => useCatalogRowMutations('event-types'), { wrapper });
    result.current.createRow({ name: 'Otro', isActive: true });
    await waitFor(() => expect(rowsNow()).toHaveLength(2));
    expect(staleAfter()).toEqual(EVERY_CACHE);

    invalidate.mockClear();
    apiPut.mockResolvedValue({ data: { data: { row: { id: 1, name: 'Boda', isActive: true } } } });
    result.current.updateRow({ id: 1, body: { name: 'Boda', isActive: true } });
    await waitFor(() => expect(staleAfter()).toEqual(EVERY_CACHE));

    // The delete re-reads when it COMMITS, not when it responds — the row is still leaving until then.
    invalidate.mockClear();
    result.current.commitDeletion(1, 'deleted');
    expect(staleAfter()).toEqual(EVERY_CACHE);
  });

  it('a form mounted AFTERWARDS re-reads the catalog it had cached', async () => {
    // The guarantee the admin actually experiences: add a detail type here, walk to the product form,
    // and it is offered — no reload. Asserted end to end rather than by spying on `invalidateQueries`,
    // because what matters is the refetch, and `staleTime: Infinity` means a cached catalog would
    // otherwise never ask again (mounting it without the mutation must NOT fetch — that is what makes
    // this test discriminate).
    client.setQueryData([QueryKeys.PRODUCT_CATALOG], { detailTypes: [] });
    apiGet.mockResolvedValue({ data: { data: { detailTypes: [{ id: 9, name: 'Test' }] } } });

    const cold = renderHook(() => useProductCatalog(), { wrapper });
    cold.unmount();
    expect(apiGet).not.toHaveBeenCalled();

    apiPost.mockResolvedValue({
      data: { data: { row: { id: 9, name: 'Test', isActive: true, isReferenced: false } } },
    });
    const { result } = renderHook(() => useCatalogRowMutations('product-detail-types'), { wrapper });
    result.current.createRow({ name: 'Test', isActive: true });
    await waitFor(() => expect(apiPost).toHaveBeenCalled());

    const form = renderHook(() => useProductCatalog(), { wrapper });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/products/catalog'));
    await waitFor(() => expect(form.result.current.data?.detailTypes).toHaveLength(1));
  });

  it('treats a missing row in the response as nothing to patch', async () => {
    apiPost.mockResolvedValue({ data: {} });
    apiPut.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useCatalogRowMutations('event-types'), { wrapper });
    result.current.createRow({ name: 'x', isActive: true });
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    result.current.updateRow({ id: 1, body: { name: 'x', isActive: true } });
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(rowsNow()).toHaveLength(1);
  });
});

describe('settingsInGroup', () => {
  it('keeps the API order within a group', () => {
    const settings = payload().settings;
    expect(settingsInGroup(settings, 'orders').map((s) => s.key)).toEqual([
      'orders.logisticsSpacingMinutes',
    ]);
    expect(settingsInGroup(settings, 'evidence')).toHaveLength(1);
    expect(settingsInGroup(settings, 'nope')).toEqual([]);
  });
});
