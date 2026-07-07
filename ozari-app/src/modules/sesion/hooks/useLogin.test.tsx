import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

const { setupRefreshTimer } = vi.hoisted(() => ({ setupRefreshTimer: vi.fn() }));
vi.mock('@utils/tokenRefresh', () => ({ setupRefreshTimer }));

const { resetForcedLogout } = vi.hoisted(() => ({ resetForcedLogout: vi.fn() }));
vi.mock('@utils/sessionLifecycle', () => ({ resetForcedLogout }));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createQueryWrapper } from '../../../test/queryWrapper';
import useLogin from './useLogin';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('useLogin', () => {
  it('posts credentials to /auth/signin (public + deviceUuid + skipErrorNotification)', async () => {
    post.mockResolvedValue({ headers: { authorization: 'Bearer TOK' }, data: {} });
    const { result } = renderHook(() => useLogin(), { wrapper: createQueryWrapper() });

    act(() => result.current.login({ email: 'a@b.com', password: 'Passw0rd!123' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(post).toHaveBeenCalledWith(
      '/auth/signin',
      { email: 'a@b.com', password: 'Passw0rd!123' },
      expect.objectContaining({ public: true, deviceUuid: true, skipErrorNotification: true }),
    );
  });

  it('on success stores the token + CSRF, re-arms the guard, and arms the refresh timer', async () => {
    post.mockResolvedValue({ headers: { authorization: 'Bearer TOK', 'x-csrf-token': 'CSRF' }, data: {} });
    const { result } = renderHook(() => useLogin(), { wrapper: createQueryWrapper() });

    act(() => result.current.login({ email: 'a@b.com', password: 'x' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(Storage.get(StorageKeys.TOKEN)).toBe('TOK');
    expect(Storage.get(StorageKeys.CSRF)).toBe('CSRF');
    expect(resetForcedLogout).toHaveBeenCalled();
    expect(setupRefreshTimer).toHaveBeenCalledWith('TOK');
  });

  it('does nothing with storage when the response carries no auth header', async () => {
    post.mockResolvedValue({ headers: {}, data: { data: { mfaRequired: true } } });
    const { result } = renderHook(() => useLogin(), { wrapper: createQueryWrapper() });

    act(() => result.current.login({ email: 'a@b.com', password: 'x' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(Storage.get(StorageKeys.TOKEN)).toBeNull();
    expect(setupRefreshTimer).not.toHaveBeenCalled();
  });

  it('logs the error on failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    post.mockRejectedValue(new Error('bad creds'));
    const { result } = renderHook(() => useLogin(), { wrapper: createQueryWrapper() });

    act(() => result.current.login({ email: 'a@b.com', password: 'x' }));
    await waitFor(() => expect(result.current.error).toBeTruthy());

    expect(console.error).toHaveBeenCalled();
  });
});
