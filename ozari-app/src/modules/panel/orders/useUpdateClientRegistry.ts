import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { ClientRegistryEnvelope } from './order.types';
import type { CreateRegistryBody } from './SchemaCreateRegistry';

/**
 * Edits a walk-in client (`PUT /client-registries/:id`, Admin-only). The body is the SAME shape as
 * create — the registry's final state — because the API validates both with one middleware, so the
 * client has one body builder (`toCreateRegistryBody`) and no second contract to keep in step.
 *
 * `skipErrorNotification` for the same reason as create: the modal owns its errors inline.
 */
export function useUpdateClientRegistry() {
  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: CreateRegistryBody }) =>
      api.put<OzariSuccessResponse<ClientRegistryEnvelope>>(`/client-registries/${id}`, body, {
        skipErrorNotification: true,
      }),
    retry: false,
  });

  return { updateRegistry: mutation.mutate, isPending: mutation.isPending };
}
