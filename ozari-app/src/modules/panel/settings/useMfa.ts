import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { QueryKeys } from '@constants/QueryKeys';
import type { OzariSuccessResponse } from '../../../types/api.types';

/** `POST /auth/mfa/setup` payload — a fresh TOTP secret + the `otpauth://` URI to render as a QR. */
export interface MfaSetupData {
  secret: string;
  otpauthUri: string;
}

/** `POST /auth/mfa/enable` payload — the one-time recovery codes, shown once and never persisted. */
export interface MfaEnableData {
  recoveryCodes: string[];
}

/**
 * Starts MFA enrollment: `POST /auth/mfa/setup` (access token + CSRF, both attached by the axios
 * interceptor) generates a pending TOTP secret and returns it plus the `otpauthUri`. The secret is
 * only *pending* until confirmed via {@link useEnableMfa}, so nothing about the user's state changes
 * yet — no ME invalidation here. `skipErrorNotification` so the enable wizard owns errors inline.
 */
export function useSetupMfa() {
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<OzariSuccessResponse<MfaSetupData>>(
        '/auth/mfa/setup',
        undefined,
        { skipErrorNotification: true },
      );
      return response.data.data ?? null;
    },
    retry: false,
  });

  return { setupMfa: mutation.mutateAsync, isPending: mutation.isPending };
}

/**
 * Confirms enrollment: `POST /auth/mfa/enable { code }` verifies the 6-digit TOTP against the pending
 * secret, flips MFA on, and returns the one-time recovery codes. On success we invalidate `ME` so the
 * settings section (and header) reflect `mfaEnabled: true`. `skipErrorNotification` so the wizard
 * lands an invalid code (401) inline on the field.
 */
export function useEnableMfa() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await api.post<OzariSuccessResponse<MfaEnableData>>(
        '/auth/mfa/enable',
        { code },
        { skipErrorNotification: true },
      );
      return response.data.data ?? null;
    },
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QueryKeys.ME] });
    },
  });

  return { enableMfa: mutation.mutateAsync, isPending: mutation.isPending };
}
