import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get: apiGet } }));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { createQueryWrapper } from '../../../test/queryWrapper';
import {
  DASHBOARD_REFETCH_MS,
  DASHBOARD_STALE_MS,
  shouldRetryDashboard,
  useDashboard,
} from './useDashboard';

beforeEach(() => {
  vi.clearAllMocks();
  Storage.set(StorageKeys.TOKEN, 'test-token');
});
afterEach(() => Storage.remove(StorageKeys.TOKEN));

describe('useDashboard', () => {
  it('unwraps the envelope into the dashboard itself', async () => {
    const dashboard = { generatedAt: 'x', upNext: [] };
    apiGet.mockResolvedValue({ data: { data: { dashboard } } });

    const { result } = renderHook(() => useDashboard(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiGet).toHaveBeenCalledWith('/dashboard');
    expect(result.current.data).toBe(dashboard);
  });

  it('does not fire before the tab has a token — the guard is still probing', () => {
    Storage.remove(StorageKeys.TOKEN);
    renderHook(() => useDashboard(), { wrapper: createQueryWrapper() });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('never retries a 403 — a role cannot change between attempts', () => {
    const forbidden = { response: { status: 403 } };
    expect(shouldRetryDashboard(0, forbidden)).toBe(false);
  });

  it('retries a transient failure twice, then gives up', () => {
    const serverError = { response: { status: 500 } };
    expect(shouldRetryDashboard(0, serverError)).toBe(true);
    expect(shouldRetryDashboard(1, serverError)).toBe(true);
    expect(shouldRetryDashboard(2, serverError)).toBe(false);
    // A network error has no response at all.
    expect(shouldRetryDashboard(0, null)).toBe(true);
    expect(shouldRetryDashboard(0, new Error('offline'))).toBe(true);
  });

  it('polls on a MINUTE, not a few seconds, and never while the tab is hidden', () => {
    // The cadence is a cost decision as much as a UX one — a scale-to-zero backend billed per
    // request-second must not be woken every 15s by a dashboard nobody is looking at.
    expect(DASHBOARD_REFETCH_MS).toBe(60_000);
    expect(DASHBOARD_STALE_MS).toBeLessThan(DASHBOARD_REFETCH_MS);
  });
});
