import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import { useForgotPassword } from './useForgotPassword';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('useForgotPassword', () => {
  it('posts the email as a public, skip-notify request', async () => {
    post.mockResolvedValue({ data: { message: 'ok' } });
    const { result } = renderHook(() => useForgotPassword(), { wrapper: createQueryWrapper() });

    act(() => result.current.requestReset({ email: 'a@b.com' }));
    await waitFor(() => expect(post).toHaveBeenCalled());

    expect(post).toHaveBeenCalledWith(
      '/auth/forgot-password',
      { email: 'a@b.com' },
      expect.objectContaining({ public: true, skipErrorNotification: true }),
    );
  });

  it('surfaces the pending state', async () => {
    let resolve: (v: unknown) => void = () => {};
    post.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useForgotPassword(), { wrapper: createQueryWrapper() });

    act(() => result.current.requestReset({ email: 'a@b.com' }));
    await waitFor(() => expect(result.current.isPending).toBe(true));
    act(() => resolve({ data: {} }));
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});
