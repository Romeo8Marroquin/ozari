import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosResponse } from 'axios';
import type { QueryClient } from '@tanstack/react-query';

const { setupRefreshTimer } = vi.hoisted(() => ({ setupRefreshTimer: vi.fn() }));
vi.mock('@utils/tokenRefresh', () => ({ setupRefreshTimer }));

const { resetForcedLogout } = vi.hoisted(() => ({ resetForcedLogout: vi.fn() }));
vi.mock('@utils/sessionLifecycle', () => ({ resetForcedLogout }));

import { StorageKeys } from '@constants/StorageKeys';
import { QueryKeys } from '@constants/QueryKeys';
import { Storage } from '@utils/storage';
import { establishSessionFromResponse } from './session';

const makeResponse = (headers: Record<string, string>): AxiosResponse =>
  ({ headers }) as unknown as AxiosResponse;

const makeQueryClient = () => ({ invalidateQueries: vi.fn() }) as unknown as QueryClient;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('establishSessionFromResponse', () => {
  it('stores the token + CSRF, refetches ME, re-arms the guard, and arms the refresh timer', () => {
    const queryClient = makeQueryClient();
    establishSessionFromResponse(
      makeResponse({ authorization: 'Bearer TOK', 'x-csrf-token': 'CSRF' }),
      queryClient,
    );

    expect(Storage.get(StorageKeys.TOKEN)).toBe('TOK');
    expect(Storage.get(StorageKeys.CSRF)).toBe('CSRF');
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.ME] });
    expect(resetForcedLogout).toHaveBeenCalled();
    expect(setupRefreshTimer).toHaveBeenCalledWith('TOK');
  });

  it('stores the token without a CSRF header present', () => {
    establishSessionFromResponse(makeResponse({ authorization: 'Bearer TOK' }), makeQueryClient());

    expect(Storage.get(StorageKeys.TOKEN)).toBe('TOK');
    expect(Storage.get(StorageKeys.CSRF)).toBeNull();
    expect(setupRefreshTimer).toHaveBeenCalledWith('TOK');
  });

  it('no-ops when the response carries no auth header (e.g. the MFA-required branch)', () => {
    const queryClient = makeQueryClient();
    establishSessionFromResponse(makeResponse({}), queryClient);

    expect(Storage.get(StorageKeys.TOKEN)).toBeNull();
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(resetForcedLogout).not.toHaveBeenCalled();
    expect(setupRefreshTimer).not.toHaveBeenCalled();
  });
});
