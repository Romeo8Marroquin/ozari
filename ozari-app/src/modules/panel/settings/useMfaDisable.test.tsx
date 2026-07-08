import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import { useMfaDisable } from './useMfaDisable';

beforeEach(() => vi.clearAllMocks());

describe('useMfaDisable', () => {
  it('POSTs /auth/mfa/disable { password } (skipErrorNotification) and invalidates ME on success', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useMfaDisable(), { wrapper: createQueryWrapper() });

    act(() => result.current.disableMfa({ password: 'Secret123!' }));
    await waitFor(() => expect(post).toHaveBeenCalled());

    expect(post).toHaveBeenCalledWith(
      '/auth/mfa/disable',
      { password: 'Secret123!' },
      expect.objectContaining({ skipErrorNotification: true }),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] }));
  });

  it('does not invalidate ME when the request fails', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    post.mockRejectedValue(new Error('bad password'));
    const { result } = renderHook(() => useMfaDisable(), { wrapper: createQueryWrapper() });

    act(() => result.current.disableMfa({ password: 'nope' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['me'] });
  });
});
