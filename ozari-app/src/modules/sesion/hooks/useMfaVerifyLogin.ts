import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { establishSessionFromResponse } from '@utils/session';
import type { OzariSuccessResponse } from '../../../types/api.types';

interface VerifyArgs {
  /** The 6-digit TOTP or the recovery code. */
  code: string;
  /** The short-lived challenge token from step 1 (kept in memory only). */
  mfaToken: string;
}

/**
 * Second login step: `POST /auth/mfa/verify-login` with the challenge `mfaToken` as a Bearer header
 * and the code in the body. On success the response carries the real session (access header + refresh
 * cookie + CSRF), established via the shared {@link establishSessionFromResponse}.
 *
 * `public: true` is load-bearing here: the request interceptor returns early on `public` **before**
 * attaching the stored access token (so our Bearer `mfaToken` survives), and the response interceptor
 * **skips the 401 refresh** for `public` requests. That's why the backend returns 422 for a wrong
 * code (retry) and reserves 401 for an expired challenge — a 401 must NOT trigger a token refresh.
 * `skipErrorNotification` so the step owns errors inline.
 */
export function useMfaVerifyLogin() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ code, mfaToken }: VerifyArgs) =>
      api.post<OzariSuccessResponse<undefined>>(
        '/auth/mfa/verify-login',
        { code },
        {
          public: true,
          deviceUuid: true,
          skipErrorNotification: true,
          headers: { Authorization: `Bearer ${mfaToken}` },
        },
      ),
    retry: false,
    onSuccess: (response) => establishSessionFromResponse(response, queryClient),
  });

  return { verify: mutation.mutate, isPending: mutation.isPending };
}
