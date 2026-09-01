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
  commitDisconnect,
  commitCreate,
  commitDelete,
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
  commitDisconnect: vi.fn(),
  commitCreate: vi.fn(),
  commitDelete: vi.fn(),
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

// The motion is real everywhere else; only the two calls whose INTENT is being asserted are spied.
// (Under the suite's reduced-motion they are no-ops, so nothing else can observe them.)
const { fadeIn, revealInScroller } = vi.hoisted(() => ({
  fadeIn: vi.fn(),
  revealInScroller: vi.fn(),
}));
vi.mock('../pageMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pageMotion')>()),
  fadeIn,
  revealInScroller,
}));

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
  useDisconnectGoogleCalendar.mockReturnValue({
    disconnect,
    isPending: false,
    commit: commitDisconnect,
  });
  useCreateCalendarFeed.mockReturnValue({ createFeed, isPending: false, commit: commitCreate });
  useDeleteCalendarFeed.mockReturnValue({ deleteFeed, isPending: false, commit: commitDelete });
  connect.mockResolvedValue('https://accounts.google.com/consent');
  disconnect.mockResolvedValue(undefined);
  createFeed.mockResolvedValue(undefined);
  deleteFeed.mockResolvedValue(undefined);
  window.history.replaceState(null, '', '/panel/ajustes');
});

/** Open a destructive action's dialog and press its confirm button. */
const confirmDialog = async (trigger: string, confirmLabel: string): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: trigger }));
  await userEvent.click(screen.getByRole('button', { name: confirmLabel }));
};

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

  it('names the connected account, and CONFIRMS before disconnecting', async () => {
    // Disconnecting stops a calendar somebody relies on from updating, so it is never a single tap.
    setStatus({
      data: status({ google: { connected: true, isActive: true, accountEmail: 'a@b.com' } }),
    });
    render(<CalendarSection />);
    expect(screen.getByText(`${KEY}.google.connectedAs`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.google.disconnect` }));
    expect(disconnect).not.toHaveBeenCalled();
    expect(screen.getByText(`${KEY}.confirm.googleDisconnect.note`)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: `${KEY}.confirm.googleDisconnect.confirm` }),
    );
    await waitFor(() => expect(commitDisconnect).toHaveBeenCalled());
    expect(disconnect).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(`${KEY}.google.disconnectedToast`);
  });

  it('keeps showing the copy it was OPENED with while it closes', async () => {
    // The dialog stays mounted through its exit animation, so it renders again with no action. It
    // used to fall back to a fixed member there, which meant dismissing the subscription dialog
    // played the GOOGLE copy fading away — a warning about the wrong act, on the way out.
    setStatus({ data: status({ feed: { isActive: true, url: FEED_URL } }) });
    render(<CalendarSection />);

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.feed.remove` }));
    expect(screen.getByText(`${KEY}.confirm.feedRemove.note`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm.cancel` }));
    expect(screen.getByText(`${KEY}.confirm.feedRemove.note`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.confirm.googleDisconnect.note`)).not.toBeInTheDocument();
  });

  it('backs out cleanly — cancelling asks the server for nothing', async () => {
    setStatus({ data: status({ google: { connected: true, isActive: true } }) });
    render(<CalendarSection />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.google.disconnect` }));
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm.cancel` }));
    expect(disconnect).not.toHaveBeenCalled();
    expect(commitDisconnect).not.toHaveBeenCalled();
  });

  it('COMMITS ONLY AFTER the server agrees, and keeps the dialog open when it does not', async () => {
    // The deletion doctrine: nothing leaves the screen on a guess. A failure is reported inline,
    // where the admin is looking, and the screen is never told to re-read itself.
    setStatus({ data: status({ google: { connected: true, isActive: true } }) });
    disconnect.mockRejectedValue({ response: { status: 500 } });
    render(<CalendarSection />);

    await confirmDialog(`${KEY}.google.disconnect`, `${KEY}.confirm.googleDisconnect.confirm`);
    await waitFor(() => expect(disconnect).toHaveBeenCalled());
    expect(commitDisconnect).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: `${KEY}.confirm.googleDisconnect.confirm` }),
    ).toBeInTheDocument();
    // A 500 is an ambient failure: the toast layer owns it.
    expect(error).toHaveBeenCalled();
  });

  it('puts a rejection the SERVER explained inside the dialog, not behind it', async () => {
    // `toFormError` is the one router the whole app shares: whatever it classifies as inline is a
    // specific answer about this action, and it belongs where the admin is looking — a toast behind
    // an open modal is a message nobody reads.
    setStatus({ data: status({ feed: { isActive: true, url: FEED_URL } }) });
    deleteFeed.mockRejectedValue(
      Object.assign(new Error('rejected'), {
        isAxiosError: true,
        response: { status: 409, data: { message: 'ya no existe' } },
      }),
    );
    render(<CalendarSection />);

    await confirmDialog(`${KEY}.feed.remove`, `${KEY}.confirm.feedRemove.confirm`);
    await waitFor(() => expect(screen.getByText('ya no existe')).toBeInTheDocument());
    expect(commitDelete).not.toHaveBeenCalled();
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

  it('shows the subscription URL only once there is one, with how to use it', () => {
    render(<CalendarSection />);
    expect(screen.queryByText(FEED_URL)).not.toBeInTheDocument();

    setStatus({ data: status({ feed: { isActive: true, url: FEED_URL } }) });
    render(<CalendarSection />);
    expect(screen.getByText(FEED_URL)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.feed.howTo`)).toBeInTheDocument();
    // Regenerating is the ONLY revoke, and it silently breaks every subscribed device — said out
    // loud, right under the button.
    expect(screen.getByText(`${KEY}.feed.revokeNote`)).toBeInTheDocument();
  });

  it('RISES a link that just arrived into view, rather than dropping it into the card', async () => {
    // Generating a link used to drop a paragraph, a URL and a button into the middle of the card in
    // one frame, shoving everything below it down with no explanation of where it came from.
    const { rerender } = render(<CalendarSection />);
    expect(fadeIn).not.toHaveBeenCalled();

    setStatus({ data: status({ feed: { isActive: true, url: FEED_URL } }) });
    rerender(<CalendarSection />);
    await waitFor(() => expect(fadeIn).toHaveBeenCalledTimes(1));
    // On a short viewport the block lands below the fold, and a link you just generated is the thing
    // you are looking for.
    expect(revealInScroller).toHaveBeenCalledTimes(1);

    // And going the other way is a DEPARTURE, which has its own exit — nothing rises in.
    setStatus();
    rerender(<CalendarSection />);
    await waitFor(() => expect(screen.queryByText(FEED_URL)).not.toBeInTheDocument());
    expect(fadeIn).toHaveBeenCalledTimes(1);
  });

  it('does NOT animate a link that was ALREADY there when the screen opened', () => {
    // It did not just appear, and a second entrance would fight the settings page's own.
    setStatus({ data: status({ feed: { isActive: true, url: FEED_URL } }) });
    render(<CalendarSection />);
    expect(fadeIn).not.toHaveBeenCalled();
  });

  it('waits for the data before deciding anything about the link', async () => {
    // Mid-load there is no answer yet, so "no link" is not a fact — adopting it would make the real
    // one, a moment later, look like it had just been generated.
    setStatus({ data: undefined, isLoading: true });
    const { rerender } = render(<CalendarSection />);
    setStatus({ data: status({ feed: { isActive: true, url: FEED_URL } }) });
    rerender(<CalendarSection />);
    await screen.findByText(FEED_URL);
    expect(fadeIn).not.toHaveBeenCalled();
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

  it('CONFIRMS before removing the feed, and says what it does to the devices', async () => {
    // The URL is already inside other people's phones, where nothing announces that it died — which
    // is exactly why this one is worth a dialog even though it is easy to regenerate.
    setStatus({ data: status({ feed: { isActive: true, url: FEED_URL } }) });
    render(<CalendarSection />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.feed.remove` }));
    expect(deleteFeed).not.toHaveBeenCalled();
    expect(screen.getByText(`${KEY}.confirm.feedRemove.note`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm.feedRemove.confirm` }));
    await waitFor(() => expect(commitDelete).toHaveBeenCalled());
    expect(deleteFeed).toHaveBeenCalled();
  });

  it('CONFIRMS a regenerate too — it silently revokes the URL already in use', async () => {
    setStatus({ data: status({ feed: { isActive: true, url: FEED_URL } }) });
    render(<CalendarSection />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.feed.regenerate` }));
    expect(createFeed).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: `${KEY}.confirm.feedRegenerate.confirm` }),
    );
    await waitFor(() => expect(commitCreate).toHaveBeenCalled());
    expect(createFeed).toHaveBeenCalled();
  });

  it('does NOT confirm the FIRST link — there is nothing to break yet', async () => {
    // A dialog in front of a harmless act teaches people to click through dialogs.
    render(<CalendarSection />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.feed.create` }));
    await waitFor(() => expect(commitCreate).toHaveBeenCalled());
    expect(createFeed).toHaveBeenCalled();
  });

  it('reports a first link that fails, instead of leaving the button sitting there', async () => {
    // No dialog is open to hold the message, so this one belongs in a toast — and it must be caught
    // at all: an uncaught rejection here is a button that looks like it did nothing.
    createFeed.mockRejectedValue(new Error('boom'));
    render(<CalendarSection />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.feed.create` }));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(`${KEY}.confirm.feedRegenerate.error`),
    );
    expect(commitCreate).not.toHaveBeenCalled();
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

