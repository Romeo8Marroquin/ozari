import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import { useResetPassword } from './useResetPassword';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('useResetPassword', () => {
  it('posts the token + new password as a public, skip-notify request', async () => {
    post.mockResolvedValue({ data: { message: 'ok' } });
    const { result } = renderHook(() => useResetPassword(), { wrapper: createQueryWrapper() });

    act(() =>
      result.current.resetPassword({
        token: 'TOK',
        newPassword: 'N3w!Passw0rd',
        confirmPassword: 'N3w!Passw0rd',
      }),
    );
    await waitFor(() => expect(post).toHaveBeenCalled());

    expect(post).toHaveBeenCalledWith(
      '/auth/reset-password',
      { token: 'TOK', newPassword: 'N3w!Passw0rd', confirmPassword: 'N3w!Passw0rd' },
      expect.objectContaining({ public: true, skipErrorNotification: true }),
    );
  });

  it('surfaces the pending state', async () => {
    let resolve: (v: unknown) => void = () => {};
    post.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useResetPassword(), { wrapper: createQueryWrapper() });

    act(() =>
      result.current.resetPassword({ token: 'T', newPassword: 'N3w!Passw0rd', confirmPassword: 'N3w!Passw0rd' }),
    );
    await waitFor(() => expect(result.current.isPending).toBe(true));
    act(() => resolve({ data: {} }));
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});
