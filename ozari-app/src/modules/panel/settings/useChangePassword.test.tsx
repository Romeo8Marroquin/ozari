import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import { useChangePassword } from './useChangePassword';

beforeEach(() => vi.clearAllMocks());

describe('useChangePassword', () => {
  it('POSTs /auth/change-password with skipErrorNotification (form owns errors)', async () => {
    post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useChangePassword(), { wrapper: createQueryWrapper() });

    const body = { currentPassword: 'Old1!aaaaaa', newPassword: 'Passw0rd!123', confirmPassword: 'Passw0rd!123' };
    act(() => result.current.changePassword(body));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      '/auth/change-password',
      body,
      expect.objectContaining({ skipErrorNotification: true }),
    );
  });
});
