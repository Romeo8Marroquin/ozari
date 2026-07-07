import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import { useEnableMfa, useSetupMfa } from './useMfa';

beforeEach(() => vi.clearAllMocks());

describe('useSetupMfa', () => {
  it('POSTs /auth/mfa/setup (no body, skipErrorNotification) and returns the setup data', async () => {
    const data = { secret: 'ABCDEF', otpauthUri: 'otpauth://totp/x' };
    post.mockResolvedValue({ data: { data } });
    const { result } = renderHook(() => useSetupMfa(), { wrapper: createQueryWrapper() });

    let resolved: unknown;
    await act(async () => {
      resolved = await result.current.setupMfa();
    });

    expect(post).toHaveBeenCalledWith(
      '/auth/mfa/setup',
      undefined,
      expect.objectContaining({ skipErrorNotification: true }),
    );
    expect(resolved).toEqual(data);
  });

  it('returns null when the response carries no data', async () => {
    post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSetupMfa(), { wrapper: createQueryWrapper() });

    let resolved: unknown = 'unset';
    await act(async () => {
      resolved = await result.current.setupMfa();
    });
    expect(resolved).toBeNull();
  });
});

describe('useEnableMfa', () => {
  it('POSTs /auth/mfa/enable { code } (skipErrorNotification), returns codes, and invalidates ME', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    post.mockResolvedValue({ data: { data: { recoveryCodes: ['AAAA', 'BBBB'] } } });
    const { result } = renderHook(() => useEnableMfa(), { wrapper: createQueryWrapper() });

    let resolved: unknown;
    await act(async () => {
      resolved = await result.current.enableMfa('123456');
    });

    expect(post).toHaveBeenCalledWith(
      '/auth/mfa/enable',
      { code: '123456' },
      expect.objectContaining({ skipErrorNotification: true }),
    );
    expect(resolved).toEqual({ recoveryCodes: ['AAAA', 'BBBB'] });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] }));
  });

  it('returns null when the response carries no data', async () => {
    post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useEnableMfa(), { wrapper: createQueryWrapper() });

    let resolved: unknown = 'unset';
    await act(async () => {
      resolved = await result.current.enableMfa('123456');
    });
    expect(resolved).toBeNull();
  });
});
