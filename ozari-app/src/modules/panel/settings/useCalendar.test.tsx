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

const { invalidateQueries, setQueryData } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries, setQueryData }),
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

/** Run the updater `commit` handed to `setQueryData` against a cache value. */
const applied = (current: unknown): unknown => {
  const updater = setQueryData.mock.calls[0]?.[1] as (value: unknown) => unknown;
  return updater(current);
};

const CACHED = { ...STATUS, google: { connected: true, isActive: true, accountEmail: 'a@b.com' } };
const NEW_URL = 'https://api.example.com/api/calendar/feed/new.ics';

describe('the writes', () => {
  it.each([
    [
      'disconnect',
      useDisconnectGoogleCalendar,
      () => apiDelete,
      '/calendar/google',
      {},
      { ...CACHED, google: { connected: false, isActive: false } },
    ],
    [
      'createFeed',
      useCreateCalendarFeed,
      () => apiPost,
      '/calendar/feed',
      { data: { url: NEW_URL } },
      { ...CACHED, feed: { isActive: true, url: NEW_URL } },
    ],
    [
      'deleteFeed',
      useDeleteCalendarFeed,
      () => apiDelete,
      '/calendar/feed',
      {},
      { ...CACHED, feed: { isActive: false } },
    ],
  ])('%s calls its endpoint, and only REPORTS', async (name, hook, verb, path, body, expected) => {
    verb().mockResolvedValue({ data: body });
    const { result } = renderHook(() => hook(), { wrapper: createQueryWrapper() });
    const write = (result.current as unknown as Record<string, () => Promise<unknown>>)[name]!;
    const answer = await write();

    expect(verb()).toHaveBeenCalled();
    expect(verb().mock.calls[0]?.[0]).toBe(path);
    // THE POINT OF THE SPLIT: a successful write does NOT change the screen by itself. The caller
    // owns that moment, because the outgoing content has to play its exit BEFORE the commit takes
    // it out of the DOM — animate-then-commit, never commit-then-try-to-animate-nothing.
    expect(setQueryData).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();

    (result.current.commit as (value: unknown) => void)(answer);
    // The ANSWER lands in the cache at once — waiting for a re-read is the stall the owner saw —
    // and the re-read still runs behind it. Nothing else in the app reads this query.
    expect(setQueryData).toHaveBeenCalledWith([QueryKeys.CALENDAR], expect.any(Function));
    expect(applied(CACHED)).toEqual(expected);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [QueryKeys.CALENDAR] });
  });

  it('leaves an empty cache alone — there is nothing to apply an answer to', async () => {
    apiDelete.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useDeleteCalendarFeed(), { wrapper: createQueryWrapper() });
    await result.current.deleteFeed();
    result.current.commit(undefined);
    expect(applied(undefined)).toBeUndefined();
  });

  it('does not invent a link the answer did not carry', async () => {
    // The background re-read brings whatever the server really holds; the cache is not guessed at.
    apiPost.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useCreateCalendarFeed(), { wrapper: createQueryWrapper() });
    const url = await result.current.createFeed();
    expect(url).toBeUndefined();
    result.current.commit(url);
    expect(applied(CACHED)).toBe(CACHED);
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
