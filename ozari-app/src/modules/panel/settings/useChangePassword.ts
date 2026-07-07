import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { ChangePasswordType } from './SchemaChangePassword';

/**
 * Changes the current user's password. `POST /auth/change-password` (access token + CSRF, both
 * attached by the axios interceptor). The backend revokes every OTHER device's session but keeps
 * THIS one — so there's no local re-login; on success we just confirm and close.
 *
 * `skipErrorNotification` so the modal owns the errors inline (wrong current password → the current
 * field, reuse → the new field); only truly ambient failures fall through to a toast (see the modal).
 */
export function useChangePassword() {
  const mutation = useMutation({
    mutationFn: (body: ChangePasswordType) =>
      api.post<OzariSuccessResponse>('/auth/change-password', body, { skipErrorNotification: true }),
    retry: false,
  });

  return { changePassword: mutation.mutate, isPending: mutation.isPending };
}
