import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import { clearAuthState } from '@utils/tokenRefresh';
import type { OzariSuccessResponse } from '../types/api.types';

/**
 * Signs the current device out. `POST /auth/signout` reads the refresh cookie for identity, so it
 * works even with an expired access token, and is idempotent (any 2xx ⇒ clear locally). The CSRF
 * header is attached automatically by the axios interceptor.
 *
 * On success it clears the local auth state (token/CSRF/refresh-timer) and then hands control to
 * `onLoggedOut`, so the caller owns the exit choreography (fade the panel out, navigate, clear the
 * query cache). On failure the axios interceptor already surfaces a toast for the failed mutation,
 * and we stay put so the caller's modal can remain open for a retry.
 */
export function useLogout(onLoggedOut?: () => void) {
  const mutation = useMutation({
    mutationFn: () => api.post<OzariSuccessResponse>('/auth/signout', {}),
    retry: false,
    onSuccess: () => {
      clearAuthState();
      onLoggedOut?.();
    },
  });

  return { logout: mutation.mutate, isPending: mutation.isPending };
}
