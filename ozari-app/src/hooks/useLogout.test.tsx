import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

import { createQueryWrapper } from '../test/queryWrapper';
import { useLogout } from './useLogout';

beforeEach(() => vi.clearAllMocks());

describe('useLogout', () => {
  it('POSTs /auth/signout and hands off to onLoggedOut on success', async () => {
    post.mockResolvedValue({ data: {} });
    const onLoggedOut = vi.fn();
    const { result } = renderHook(() => useLogout(onLoggedOut), { wrapper: createQueryWrapper() });

    act(() => result.current.logout());

    await waitFor(() => expect(onLoggedOut).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/auth/signout', {});
  });

  it('does not call onLoggedOut when signout fails', async () => {
    post.mockRejectedValue(new Error('nope'));
    const onLoggedOut = vi.fn();
    const { result } = renderHook(() => useLogout(onLoggedOut), { wrapper: createQueryWrapper() });

    act(() => result.current.logout());

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(onLoggedOut).not.toHaveBeenCalled();
  });
});
