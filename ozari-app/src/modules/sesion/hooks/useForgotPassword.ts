import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';

interface ForgotPasswordArgs {
  email: string;
}

/**
 * Requests a password reset: `POST /auth/forgot-password { email }`. A `public` request (no session,
 * no access token attached, no 401 refresh) with `skipErrorNotification` so the calling step owns the
 * outcome — the backend ALWAYS returns a generic success (anti-enumeration), so callers show the same
 * confirmation regardless of whether the email exists.
 */
export function useForgotPassword() {
  const mutation = useMutation({
    mutationFn: ({ email }: ForgotPasswordArgs) =>
      api.post<OzariSuccessResponse<undefined>>(
        '/auth/forgot-password',
        { email },
        { public: true, skipErrorNotification: true },
      ),
    retry: false,
  });

  return { requestReset: mutation.mutate, isPending: mutation.isPending };
}
