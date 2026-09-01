import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useCalendar,
  connect,
  useConnectGoogleCalendar,
  disconnect,
  useDisconnectGoogleCalendar,
  createFeed,
  useCreateCalendarFeed,
  deleteFeed,
  useDeleteCalendarFeed,
} = vi.hoisted(() => ({
  useCalendar: vi.fn(),
  connect: vi.fn(),
  useConnectGoogleCalendar: vi.fn(),
  disconnect: vi.fn(),
  useDisconnectGoogleCalendar: vi.fn(),
  createFeed: vi.fn(),
  useCreateCalendarFeed: vi.fn(),
  deleteFeed: vi.fn(),
  useDeleteCalendarFeed: vi.fn(),
}));
vi.mock('./useCalendar', () => ({
  useCalendar,
  useConnectGoogleCalendar,
  useDisconnectGoogleCalendar,
  useCreateCalendarFeed,
  useDeleteCalendarFeed,
}));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

import CalendarSection from './CalendarSection';
import type { CalendarStatus } from './calendar.types';

const KEY = 'modules.panel.settings.calendar';
const FEED_URL = 'https://api.example.com/api/calendar/feed/abc123.ics';

const status = (over: Partial<CalendarStatus> = {}): CalendarStatus => ({
  google: { connected: false, isActive: false },
  feed: { isActive: false },
  reminderMinutes: 1440,
  googleAvailable: true,
  ...over,
});

const setStatus = (over: Record<string, unknown> = {}) =>
  useCalendar.mockReturnValue({ data: status(), isLoading: false, isError: false, ...over });

/** The real `window.location`. One test swaps it for a stub with a spy-able `assign`, and without
 *  putting it back every later test would read that stub's frozen `search`. */
const REAL_LOCATION = window.location;

afterEach(() => {
  Object.defineProperty(window, 'location', { value: REAL_LOCATION, configurable: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  setStatus();
  useConnectGoogleCalendar.mockReturnValue({ connect, isPending: false });
  useDisconnectGoogleCalendar.mockReturnValue({ disconnect, isPending: false });
  useCreateCalendarFeed.mockReturnValue({ createFeed, isPending: false });
  useDeleteCalendarFeed.mockReturnValue({ deleteFeed, isPending: false });
  connect.mockResolvedValue('https://accounts.google.com/consent');
  window.history.replaceState(null, '', '/panel/ajustes');
});

describe('CalendarSection', () => {
  it('offers BOTH halves, and says why the second one exists', () => {
    // They are not alternatives: Apple publishes no calendar write API at all, so a subscription is
    // the mechanism those apps actually offer — not a lesser version of the Google integration.
    render(<CalendarSection />);
    expect(screen.getByText(`${KEY}.google.label`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.feed.label`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.feed.description`)).toBeInTheDocument();
  });

  it('navigates THIS tab to the consent URL the API minted', async () => {
    // The URL is fetched rather than linked to because it carries a signed `state` for this admin;
    // and it opens in the current tab because a consent screen in a popup dies on mobile browsers.
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, search: '', pathname: '/panel/ajustes' },
      configurable: true,
    });
    render(<CalendarSection />);

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.google.connect` }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/consent'));
  });

  it('names the connected account, and offers the way out', async () => {
    setStatus({
      data: status({ google: { connected: true, isActive: true, accountEmail: 'a@b.com' } }),
    });
    render(<CalendarSection />);
    expect(screen.getByText(`${KEY}.google.connectedAs`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.google.disconnect` }));
    expect(disconnect).toHaveBeenCalled();
  });

  it('still says it is connected when Google gave us no address to show', () => {
    // The email is a label, not the connection: fetching it is best-effort, and a missing one must
    // not make a working integration read as unconfigured.
    setStatus({ data: status({ google: { connected: true, isActive: true } }) });
    render(<CalendarSection />);
    expect(screen.getByText(`${KEY}.google.connectedAs`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${KEY}.google.disconnect` })).toBeInTheDocument();
  });

  it('says so plainly when the deployment has no Google credentials', () => {
    // A Connect button that could only ever fail is worse than none: the feed still works, and the
    // copy explains which half is missing.
    setStatus({ data: status({ googleAvailable: false }) });
    render(<CalendarSection />);
    expect(screen.getByText(`${KEY}.google.unavailable`)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `${KEY}.google.connect` }),
    ).not.toBeInTheDocument();
  });

  it('shows the subscription URL only once there is one, with how to use it', async () => {
    render(<CalendarSection />);
    expect(screen.queryByText(FEED_URL)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.feed.create` }));
    expect(createFeed).toHaveBeenCalled();

    setStatus({ data: status({ feed: { isActive: true, url: FEED_URL } }) });
    render(<CalendarSection />);
    expect(screen.getByText(FEED_URL)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.feed.howTo`)).toBeInTheDocument();
    // Regenerating is the ONLY revoke, and it silently breaks every subscribed device — said out
    // loud, right under the button.
    expect(screen.getByText(`${KEY}.feed.revokeNote`)).toBeInTheDocument();
  });

  it('copies the URL, and SAYS SO when the clipboard refuses', async () => {
    setStatus({ data: status({ feed: { isActive: true, url: FEED_URL } }) });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CalendarSection />);

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.feed.copy` }));
    expect(writeText).toHaveBeenCalledWith(FEED_URL);
    await waitFor(() => expect(success).toHaveBeenCalledWith(`${KEY}.feed.copied`));

    // An insecure origin or a permission policy can refuse it. A button that silently does nothing
    // is worse than one that admits it — the URL is selectable on screen either way.
    writeText.mockRejectedValue(new Error('denied'));
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.feed.copyAgain` }));
    await waitFor(() => expect(error).toHaveBeenCalledWith(`${KEY}.feed.copyFailed`));
  });

  it('removes the feed when asked', async () => {
    setStatus({ data: status({ feed: { isActive: true, url: FEED_URL } }) });
    render(<CalendarSection />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.feed.remove` }));
    expect(deleteFeed).toHaveBeenCalled();
  });

  it('states the lead time in a unit a person would say', () => {
    // The KEY is what the mocked translator returns; `leadTimeKey`'s own suite pins the count.
    setStatus({ data: status({ reminderMinutes: 120 }) });
    render(<CalendarSection />);
    expect(screen.getByText(`${KEY}.reminder.hours`)).toBeInTheDocument();
  });

  it('announces the consent round trip ONCE, then cleans the URL', () => {
    // A reload must not re-congratulate you, and a bookmark of this page must not either.
    window.history.replaceState(null, '', '/panel/ajustes?calendario=conectado');
    const { unmount } = render(<CalendarSection />);
    expect(success).toHaveBeenCalledWith(`${KEY}.google.connectedToast`);
    expect(window.location.search).toBe('');
    unmount();

    render(<CalendarSection />);
    expect(success).toHaveBeenCalledTimes(1);
  });

  it('reports a failed consent round trip too', () => {
    window.history.replaceState(null, '', '/panel/ajustes?calendario=error');
    render(<CalendarSection />);
    expect(error).toHaveBeenCalledWith(`${KEY}.google.errorToast`);
  });

  it('reports a failure to even START the flow', async () => {
    connect.mockRejectedValue(new Error('503'));
    render(<CalendarSection />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.google.connect` }));
    await waitFor(() => expect(error).toHaveBeenCalledWith(`${KEY}.google.errorToast`));
  });

  it('says so plainly when the settings cannot be read at all', () => {
    setStatus({ data: undefined, isError: true });
    render(<CalendarSection />);
    expect(screen.getByText(`${KEY}.error`)).toBeInTheDocument();
  });

  it('shows placeholders rather than a fake state while loading', () => {
    setStatus({ data: undefined, isLoading: true });
    render(<CalendarSection />);
    expect(screen.queryByRole('button', { name: `${KEY}.google.connect` })).not.toBeInTheDocument();
  });
});
