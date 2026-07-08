import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { MfaDisableType } from './SchemaMfaDisable';

/**
 * Disables MFA: `POST /auth/mfa/disable { password }` (access token + CSRF attached by the axios
 * interceptor). The backend re-verifies the account password (a wrong one → 422, never 401), then
 * clears the TOTP secret + all recovery codes in one transaction. On success we invalidate `ME` so the
 * settings switch (and header) reflect `mfaEnabled: false`.
 *
 * `skipErrorNotification` so the modal owns a wrong password inline. Disabling deliberately keeps the
 * user's OTHER sessions (nothing to protect — no credential changed, and the password was just
 * re-verified); session revocation is reserved for credential changes / explicit device management.
 */
export function useMfaDisable() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (body: MfaDisableType) =>
      api.post<OzariSuccessResponse>('/auth/mfa/disable', body, { skipErrorNotification: true }),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ME] });
    },
  });

  return { disableMfa: mutation.mutate, isPending: mutation.isPending };
}
