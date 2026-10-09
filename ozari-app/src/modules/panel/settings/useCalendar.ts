import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { getStatus } from '@utils/apiError';
import type { AxiosError } from 'axios';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { CalendarStatus, CalendarStatusEnvelope } from './calendar.types';

/**
 * The calendar settings, and the three writes that change them.
 *
 * `staleTime: 0` and a refetch on focus, deliberately against the app's usual grain: connecting
 * happens in ANOTHER TAB (Google's consent page) and finishes by sending the browser back here, so
 * this is one of the few screens where "something changed while you were away" is the normal case
 * rather than the exception.
 */
export function useCalendar() {
  return useQuery({
    queryKey: [QueryKeys.CALENDAR],
    queryFn: async (): Promise<CalendarStatus | null> => {
      const { data } = await api.get<OzariSuccessResponse<CalendarStatusEnvelope>>('/calendar');
      return data.data?.calendar ?? null;
    },
    refetchOnWindowFocus: true,
    retry: shouldRetryCalendar,
  });
}

/** A 403 is the settled answer for every non-admin and will not change by asking again; anything
 *  else gets the usual couple of attempts. Exported because it is a decision, not plumbing. */
export function shouldRetryCalendar(count: number, error: unknown): boolean {
  return getStatus(error as AxiosError) !== 403 && count < 2;
}

/**
 * Every calendar mutation refreshes the one query behind this screen — nothing else in the app reads
 * it, so there is no wider invalidation to do.
 *
 * **The write only REPORTS; `commit` is what changes the screen.** That split is the deletion
 * doctrine (`useCatalogRowMutations` is the reference): a row must never leave before the server
 * agreed it should, and the exit has to play BETWEEN the answer and the re-read — otherwise the
 * content is gone from the DOM before there is anything left to animate, and the card just snaps
 * shut. So: request → (on the answer) play the exit → `commit(answer)` → the screen changes.
 *
 * ⚠️ **`commit` writes the server's ANSWER into the cache, and only then re-reads.** It used to
 * only invalidate, which put a whole extra round trip between "the server agreed" and "the screen
 * changed": the spinner stopped, the old state sat there (or, on a removal, an already-faded block
 * held an empty gap open) for as long as `GET /calendar` took, and only then did the card move — the
 * "it gets stuck" the owner reported (2026-10-09). Nothing here is a guess: the POST hands back the
 * new URL, and a 2xx on a DELETE IS the report that the thing is gone. The re-read still runs, in the
 * background, and hands back the same state — so the morph key does not change and nothing replays.
 */
function useCalendarMutation<TResult>(
  mutationFn: () => Promise<TResult>,
  apply: (current: CalendarStatus, answer: TResult) => CalendarStatus,
) {
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn, retry: false });
  const commit = useCallback(
    (answer: TResult): void => {
      queryClient.setQueryData<CalendarStatus | null>([QueryKeys.CALENDAR], (current) =>
        current ? apply(current, answer) : current,
      );
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.CALENDAR] });
    },
    [queryClient, apply],
  );
  return { mutation, commit };
}

/** What each write's answer means for the screen. Module-level so `commit` stays stable. */
const withoutGoogle = (current: CalendarStatus): CalendarStatus => ({
  ...current,
  google: { connected: false, isActive: false },
});
const withFeed = (current: CalendarStatus, url: string | undefined): CalendarStatus =>
  // No URL in the answer is not something to invent around: leave the cache alone and let the
  // background re-read bring whatever the server actually holds.
  url ? { ...current, feed: { isActive: true, url } } : current;
const withoutFeed = (current: CalendarStatus): CalendarStatus => ({
  ...current,
  feed: { isActive: false },
});

/**
 * Asks the API where to send the browser for Google's consent.
 *
 * The URL is fetched rather than linked to directly, because it carries a signed `state` minted for
 * THIS admin — a static href could not. The caller navigates the current tab to it: an OAuth consent
 * screen opened in a popup is where the flow goes to die on mobile browsers.
 */
export function useConnectGoogleCalendar() {
  const mutation = useMutation({
    mutationFn: async (): Promise<string> => {
      const { data } = await api.get<OzariSuccessResponse<{ authorizeUrl: string }>>(
        '/calendar/google/authorize',
        { skipErrorNotification: true },
      );
      const url = data.data?.authorizeUrl;
      if (!url) {
        // Nothing to navigate to is a failure, not a no-op: sending the browser to `undefined`
        // would land on a broken page with no way back to the settings screen.
        throw new Error('missing authorize url');
      }
      return url;
    },
    retry: false,
  });
  return { connect: mutation.mutateAsync, isPending: mutation.isPending };
}

export function useDisconnectGoogleCalendar() {
  const { mutation, commit } = useCalendarMutation(async (): Promise<void> => {
    await api.delete('/calendar/google', { skipErrorNotification: true });
  }, withoutGoogle);
  return { disconnect: mutation.mutateAsync, isPending: mutation.isPending, commit };
}

/** Mints the subscription URL — and REGENERATES it, which is the same call and the only way to
 *  revoke a URL that has already been pasted into a device. Resolves to the new URL. */
export function useCreateCalendarFeed() {
  const { mutation, commit } = useCalendarMutation(async (): Promise<string | undefined> => {
    const { data } = await api.post<OzariSuccessResponse<{ url: string }>>(
      '/calendar/feed',
      {},
      { skipErrorNotification: true },
    );
    return data.data?.url;
  }, withFeed);
  return { createFeed: mutation.mutateAsync, isPending: mutation.isPending, commit };
}

export function useDeleteCalendarFeed() {
  const { mutation, commit } = useCalendarMutation(async (): Promise<void> => {
    await api.delete('/calendar/feed', { skipErrorNotification: true });
  }, withoutFeed);
  return { deleteFeed: mutation.mutateAsync, isPending: mutation.isPending, commit };
}
