import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get } }));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createQueryWrapper } from '../../../test/queryWrapper';
import { useMe } from './useMe';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('useMe', () => {
  it('fetches /auth/me when a token is present and unwraps the profile', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    const profile = {
      id: 1,
      email: 'a@b.com',
      fullName: 'Ana',
      role: 'Client',
      mfaEnabled: false,
      createdAt: '2026-01-01',
    };
    get.mockResolvedValue({ data: { data: profile } });

    const { result } = renderHook(() => useMe(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/auth/me');
    expect(result.current.data).toMatchObject({ id: 1, fullName: 'Ana' });
  });

  it('is disabled (never fetches) when there is no token', () => {
    const { result } = renderHook(() => useMe(), { wrapper: createQueryWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('unwraps to null when the profile payload is absent', async () => {
    Storage.set(StorageKeys.TOKEN, 'tok');
    get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useMe(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
