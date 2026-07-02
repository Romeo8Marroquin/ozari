import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import useRegister from './useRegister';

beforeEach(() => vi.clearAllMocks());

describe('useRegister', () => {
  it('posts the registration to /auth/user (public + skipErrorNotification)', async () => {
    post.mockResolvedValue({ data: { data: { id: '1' } } });
    const { result } = renderHook(() => useRegister(), { wrapper: createQueryWrapper() });

    const body = {
      fullName: 'Ana López',
      email: 'ana@example.com',
      password: 'Passw0rd!123',
      confirmPassword: 'Passw0rd!123',
      termsAccepted: true,
    };
    act(() => result.current.register(body));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(post).toHaveBeenCalledWith(
      '/auth/user',
      body,
      expect.objectContaining({ public: true, skipErrorNotification: true }),
    );
  });

  it('surfaces the error on failure', async () => {
    post.mockRejectedValue(new Error('taken'));
    const { result } = renderHook(() => useRegister(), { wrapper: createQueryWrapper() });

    act(() =>
      result.current.register({
        fullName: 'X',
        email: 'x@y.com',
        password: 'p',
        confirmPassword: 'p',
        termsAccepted: true,
      }),
    );
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
