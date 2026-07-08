import type { QueryClient } from '@tanstack/react-query';
import type { AxiosResponse } from 'axios';
import { StorageKeys } from '@constants/StorageKeys';
import { QueryKeys } from '@constants/QueryKeys';
import { Storage } from '@utils/storage';
import { setupRefreshTimer } from '@utils/tokenRefresh';
import { resetForcedLogout } from '@utils/sessionLifecycle';

/**
 * Establishes a client session from an auth response that carries the access token in its
 * `Authorization` header. Shared by the two entry points that mint a session: a normal login
 * (`useLogin`) and the MFA second step (`useMfaVerifyLogin`) — both return the token the same way,
 * so the "store token + CSRF, re-arm the forced-logout guard, arm the proactive refresh timer,
 * refetch `/auth/me`" sequence lives in exactly one place.
 *
 * No-ops when there's no bearer token (e.g. a `signin` that returned `{ mfaRequired }` and no
 * session yet), mirroring the backend contract.
 */
export function establishSessionFromResponse(
  response: AxiosResponse,
  queryClient: QueryClient,
): void {
  const bearer = response.headers['authorization'];
  if (!bearer) return;

  const token = bearer.split(' ')[1];
  Storage.set(StorageKeys.TOKEN, token);

  // The session issues a CSRF token alongside it (response header) — needed for every later
  // state-changing call (refresh, signout, change-password, MFA management).
  const csrfToken = response.headers['x-csrf-token'];
  if (csrfToken) Storage.set(StorageKeys.CSRF, csrfToken);

  queryClient.invalidateQueries({ queryKey: [QueryKeys.ME] });

  // A fresh session re-arms the forced-logout guard so a later death can tear down again.
  resetForcedLogout();
  setupRefreshTimer(token);
}
