import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { Dashboard, DashboardEnvelope } from './dashboard.types';

/**
 * How long an answer is considered current. A dashboard is a REFERENCE, not an instrument panel: the
 * admin needs "roughly now", and every figure on it changes on the scale of minutes at most.
 */
export const DASHBOARD_STALE_MS = 30_000;

/**
 * How often it re-reads itself while the tab is actually being looked at.
 *
 * **Deliberately 60s and not the 10–30s that "live" suggests.** The backend scales to zero and bills
 * per request-second: a dashboard left open on a second monitor all day at 15s costs ~2,300 needless
 * requests and keeps an instance warm for no one. 60 seconds plus a refetch on window focus makes it
 * feel instant in the only case that matters — coming back to the tab — while an idle tab costs
 * nothing, because `refetchIntervalInBackground` stays false and React Query pauses the interval
 * when the window is hidden. Actions taken HERE bypass the interval entirely: the advance mutation
 * cancels and re-reads immediately (`useAdvanceOrder`), so the screen never waits on the poll to
 * reflect the admin's own tap.
 */
export const DASHBOARD_REFETCH_MS = 60_000;

/**
 * Whether a failed read is worth retrying.
 *
 * A non-admin who reached this by a stale bookmark gets a clean `403`, and retrying that three times
 * only burns the rate limit on an answer that cannot change. Everything else (a blip, a 5xx) gets
 * the standard two retries.
 */
export function shouldRetryDashboard(failureCount: number, error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 403 ? false : failureCount < 2;
}

/**
 * The admin home screen's single query (`GET /dashboard`, Admin-only).
 *
 * One request for the whole screen — see the endpoint's own note on why: every figure has to be a
 * snapshot of the same instant, and six aggregates would be six round trips on a cold start.
 */
export function useDashboard() {
  const query = useQuery({
    queryKey: [QueryKeys.DASHBOARD],
    queryFn: async (): Promise<Dashboard> => {
      const { data } = await api.get<OzariSuccessResponse<DashboardEnvelope>>('/dashboard');
      /* v8 ignore next -- a 2xx always carries the envelope; the guard is defensive */
      if (!data.data) throw new Error('empty dashboard payload');
      return data.data.dashboard;
    },
    // Same guard as the other panel queries: never fire on a tab that has no access token yet (the
    // route guard is still probing), or the first paint spends a request on a guaranteed 401.
    enabled: Boolean(Storage.get(StorageKeys.TOKEN)),
    staleTime: DASHBOARD_STALE_MS,
    refetchInterval: DASHBOARD_REFETCH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: shouldRetryDashboard,
  });

  return query;
}
