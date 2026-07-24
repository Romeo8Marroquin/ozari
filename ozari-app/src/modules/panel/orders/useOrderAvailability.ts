import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { OrderAvailabilityBody, OrderAvailabilityResponse } from './order.types';

/**
 * The live per-window availability probe (`POST /orders/availability`, Admin-only). The order form
 * fires it when the delivery/pickup window changes, to annotate the product picker with takeable
 * amounts and reconcile already-picked lines. `skipErrorNotification` — availability is ADVISORY
 * (the create path re-checks under a lock), so a probe failure stays silent and the form keeps all
 * products; the real guard is the submit-time 409.
 */
export function useOrderAvailability() {
  const mutation = useMutation({
    mutationFn: (body: OrderAvailabilityBody) =>
      api.post<OzariSuccessResponse<OrderAvailabilityResponse>>('/orders/availability', body, {
        skipErrorNotification: true,
      }),
    retry: false,
  });

  return { checkAvailability: mutation.mutate };
}
