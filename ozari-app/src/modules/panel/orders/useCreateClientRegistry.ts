import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { ClientRegistryEnvelope } from './order.types';
import type { CreateRegistryBody } from './SchemaCreateRegistry';

/**
 * Creates a walk-in client registry (`POST /client-registries`, Admin-only). `skipErrorNotification`
 * so the modal owns its errors inline (400 validation) and toasts ambient failures. The response is
 * the projected registry, which the caller writes straight into the picker cache + selects.
 */
export function useCreateClientRegistry() {
  const mutation = useMutation({
    mutationFn: (body: CreateRegistryBody) =>
      api.post<OzariSuccessResponse<ClientRegistryEnvelope>>('/client-registries', body, {
        skipErrorNotification: true,
      }),
    retry: false,
  });

  return { createRegistry: mutation.mutate, isPending: mutation.isPending };
}
