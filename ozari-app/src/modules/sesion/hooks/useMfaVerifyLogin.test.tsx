import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

const { establishSessionFromResponse } = vi.hoisted(() => ({ establishSessionFromResponse: vi.fn() }));
vi.mock('@utils/session', () => ({ establishSessionFromResponse }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import { useMfaVerifyLogin } from './useMfaVerifyLogin';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('useMfaVerifyLogin', () => {
  it('posts the code with the mfaToken as a Bearer header, public + skip-notify', async () => {
    post.mockResolvedValue({ headers: { authorization: 'Bearer T' } });
    const { result } = renderHook(() => useMfaVerifyLogin(), { wrapper: createQueryWrapper() });

    act(() => result.current.verify({ code: '123456', mfaToken: 'MFA_TOK' }));
    await waitFor(() => expect(post).toHaveBeenCalled());

    expect(post).toHaveBeenCalledWith(
      '/auth/mfa/verify-login',
      { code: '123456' },
      expect.objectContaining({
        public: true,
        deviceUuid: true,
        skipErrorNotification: true,
        headers: { Authorization: 'Bearer MFA_TOK' },
      }),
    );
  });

  it('establishes the session from the response on success', async () => {
    const response = { headers: { authorization: 'Bearer T', 'x-csrf-token': 'C' } };
    post.mockResolvedValue(response);
    const { result } = renderHook(() => useMfaVerifyLogin(), { wrapper: createQueryWrapper() });

    act(() => result.current.verify({ code: '123456', mfaToken: 'MFA_TOK' }));
    await waitFor(() => expect(establishSessionFromResponse).toHaveBeenCalled());
    expect(establishSessionFromResponse).toHaveBeenCalledWith(response, expect.anything());
  });

  it('does not establish a session when the request fails', async () => {
    post.mockRejectedValue(new Error('bad code'));
    const { result } = renderHook(() => useMfaVerifyLogin(), { wrapper: createQueryWrapper() });

    act(() => result.current.verify({ code: '000000', mfaToken: 'MFA_TOK' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(establishSessionFromResponse).not.toHaveBeenCalled();
  });
});
