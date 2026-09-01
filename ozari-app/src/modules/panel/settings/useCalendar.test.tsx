import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet, apiPost, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));
vi.mock('@api/client', () => ({
  api: { get: apiGet, post: apiPost, delete: apiDelete },
}));

const { invalidateQueries } = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries }),
}));

import { QueryKeys } from '@constants/QueryKeys';
import { createQueryWrapper } from '../../../test/queryWrapper';
import {
  shouldRetryCalendar,
  useCalendar,
  useConnectGoogleCalendar,
  useCreateCalendarFeed,
  useDeleteCalendarFeed,
  useDisconnectGoogleCalendar,
} from './useCalendar';

const STATUS = {
  google: { connected: true, isActive: true },
  feed: { isActive: false },
  reminderMinutes: 1440,
  googleAvailable: true,
};

beforeEach(() => vi.clearAllMocks());

describe('useCalendar', () => {
  it('unwraps the envelope', async () => {
    apiGet.mockResolvedValue({ data: { data: { calendar: STATUS } } });
    const { result } = renderHook(() => useCalendar(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(STATUS));
    expect(apiGet).toHaveBeenCalledWith('/calendar');
  });

  it('reads an empty envelope as NO settings rather than crashing on it', async () => {
    apiGet.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useCalendar(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.data).toBeNull());
  });
});

describe('shouldRetryCalendar', () => {
  it('gives up immediately on a 403 — that is the settled answer for a non-admin', () => {
    expect(shouldRetryCalendar(0, { response: { status: 403 } })).toBe(false);
  });

  it('retries anything else, a couple of times', () => {
    expect(shouldRetryCalendar(0, { response: { status: 500 } })).toBe(true);
    expect(shouldRetryCalendar(2, { response: { status: 500 } })).toBe(false);
  });
});

describe('useConnectGoogleCalendar', () => {
  it('fetches the consent URL rather than linking to a static one', async () => {
    // It carries a signed `state` minted for THIS admin, which an href in the markup could not.
    apiPost.mockReset();
    apiGet.mockResolvedValue({ data: { data: { authorizeUrl: 'https://consent' } } });
    const { result } = renderHook(() => useConnectGoogleCalendar(), {
      wrapper: createQueryWrapper(),
    });
    await expect(result.current.connect()).resolves.toBe('https://consent');
    expect(apiGet).toHaveBeenCalledWith('/calendar/google/authorize', {
      skipErrorNotification: true,
    });
  });

  it('FAILS when there is no URL — navigating to `undefined` is a dead end', async () => {
    apiGet.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useConnectGoogleCalendar(), {
      wrapper: createQueryWrapper(),
    });
    await expect(result.current.connect()).rejects.toThrow(/authorize url/u);
  });
});

describe('the writes', () => {
  it.each([
    ['disconnect', useDisconnectGoogleCalendar, () => apiDelete, '/calendar/google'],
    ['createFeed', useCreateCalendarFeed, () => apiPost, '/calendar/feed'],
    ['deleteFeed', useDeleteCalendarFeed, () => apiDelete, '/calendar/feed'],
  ])('%s calls its endpoint, and only REPORTS', async (name, hook, verb, path) => {
    verb().mockResolvedValue({ data: {} });
    const { result } = renderHook(() => hook(), { wrapper: createQueryWrapper() });
    const write = (result.current as unknown as Record<string, () => Promise<unknown>>)[name]!;
    await write();

    expect(verb()).toHaveBeenCalled();
    expect(verb().mock.calls[0]?.[0]).toBe(path);
    // THE POINT OF THE SPLIT: a successful write does NOT refresh the screen by itself. The caller
    // owns that moment, because the outgoing content has to play its exit BEFORE the re-read takes
    // it out of the DOM — animate-then-commit, never commit-then-try-to-animate-nothing.
    expect(invalidateQueries).not.toHaveBeenCalled();

    result.current.commit();
    // Nothing else in the app reads this query, so there is no wider invalidation to do.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.CALENDAR] });
  });

  it('REJECTS a failed write, so the caller can keep the dialog open and say why', async () => {
    apiDelete.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDeleteCalendarFeed(), {
      wrapper: createQueryWrapper(),
    });
    await expect(result.current.deleteFeed()).rejects.toThrow('boom');
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
