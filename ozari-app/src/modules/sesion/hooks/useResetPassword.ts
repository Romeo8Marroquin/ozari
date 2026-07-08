import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';

interface ResetPasswordArgs {
  token: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * Completes a password reset: `POST /auth/reset-password { token, newPassword, confirmPassword }`. A
 * `public` request (no session) with `skipErrorNotification` so the reset page owns the outcome — an
 * invalid/expired token or a reused password comes back as a generic `400` handled inline; on success
 * the backend revokes ALL sessions and the page animates to login.
 */
export function useResetPassword() {
  const mutation = useMutation({
    mutationFn: ({ token, newPassword, confirmPassword }: ResetPasswordArgs) =>
      api.post<OzariSuccessResponse<undefined>>(
        '/auth/reset-password',
        { token, newPassword, confirmPassword },
        { public: true, skipErrorNotification: true },
      ),
    retry: false,
  });

  return { resetPassword: mutation.mutate, isPending: mutation.isPending };
}
