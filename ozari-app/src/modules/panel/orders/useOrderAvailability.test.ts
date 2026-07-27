import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import { useOrderAvailability } from './useOrderAvailability';

afterEach(() => vi.clearAllMocks());

describe('useOrderAvailability', () => {
  it('posts the window + product ids to the availability endpoint (errors stay silent)', async () => {
    post.mockResolvedValue({ data: { data: { availability: [{ productId: 3, available: 5 }] } } });
    const { result } = renderHook(() => useOrderAvailability(), { wrapper: createQueryWrapper() });

    result.current.checkAvailability({ deliveryAt: '2026-08-01T14:00:00.000Z', productIds: [3] });
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      '/orders/availability',
      { deliveryAt: '2026-08-01T14:00:00.000Z', productIds: [3] },
      { skipErrorNotification: true },
    );
  });
});
