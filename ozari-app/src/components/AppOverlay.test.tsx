import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppOverlay from './AppOverlay';
import { useOutageStore } from '../stores/outageStore';

// The health poller is the overlay's only side-effect on the network; mock it so probes are
// deterministic (no real axios client, no interceptor stack).
const { checkHealth } = vi.hoisted(() => ({ checkHealth: vi.fn() }));
vi.mock('@utils/health', () => ({ checkHealth }));

const setOnline = (value: boolean): void => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
};

/** Render the overlay in its own QueryClient so we can watch `invalidateQueries` on recovery. */
const renderOverlay = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={client}>
      <AppOverlay />
    </QueryClientProvider>,
  );
  return { ...utils, invalidate };
};

beforeEach(() => {
  useOutageStore.setState({ active: false });
  checkHealth.mockReset();
  checkHealth.mockResolvedValue(false);
  setOnline(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  setOnline(true);
  document.body.style.overflow = '';
});

describe('AppOverlay', () => {
  it('renders nothing while inactive', () => {
    renderOverlay();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('renders a blocking, labelled dialog when active', () => {
    useOutageStore.setState({ active: true });
    renderOverlay();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'errorScreen.overlayLabel');
  });

  it('shows the maintenance copy while online (backend outage)', () => {
    setOnline(true);
    useOutageStore.setState({ active: true });
    renderOverlay();
    expect(screen.getByText('errorScreen.maintenance.title')).toBeInTheDocument();
    expect(screen.getByText('errorScreen.maintenance.autoRetrying')).toBeInTheDocument();
    // Online mounts already cooling down to the first auto-probe, so the button shows the countdown.
    expect(screen.getByText('errorScreen.maintenance.retryIn')).toBeInTheDocument();
  });

  it('shows the offline copy while the browser is offline', () => {
    setOnline(false);
    useOutageStore.setState({ active: true });
    renderOverlay();
    expect(screen.getByText('errorScreen.offline.title')).toBeInTheDocument();
    expect(screen.getByText('errorScreen.offline.autoWaiting')).toBeInTheDocument();
    // Offline mounts with the button enabled (manual/event driven), so it shows the action label.
    expect(screen.getByText('errorScreen.offline.action')).toBeInTheDocument();
  });

  it('a failed manual retry shows a reason-specific note', async () => {
    setOnline(false);
    checkHealth.mockResolvedValue(false);
    useOutageStore.setState({ active: true });
    renderOverlay();

    fireEvent.click(screen.getByRole('button'));
    expect(checkHealth).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('errorScreen.offline.retryFailed')).toBeInTheDocument(),
    );
  });

  it('clears then re-derives the failure note across a connectivity change', async () => {
    setOnline(false);
    checkHealth.mockResolvedValue(false);
    useOutageStore.setState({ active: true });
    renderOverlay();

    // First failure paints the offline note.
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(screen.getByText('errorScreen.offline.retryFailed')).toBeInTheDocument(),
    );

    // Reconnecting kicks a fresh probe: the note briefly clears (message -> undefined), then the
    // still-failing server re-derives it as the maintenance note.
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() =>
      expect(screen.getByText('errorScreen.maintenance.retryFailed')).toBeInTheDocument(),
    );
  });

  it('a healthy probe recovers: deactivates the overlay and invalidates all queries', async () => {
    setOnline(false);
    checkHealth.mockResolvedValue(true);
    useOutageStore.setState({ active: true });
    const { invalidate } = renderOverlay();

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(invalidate).toHaveBeenCalled();
    expect(useOutageStore.getState().active).toBe(false);
  });

  it('stops auto-retrying after the attempt cap and says so', () => {
    setOnline(true);
    checkHealth.mockResolvedValue(false);
    useOutageStore.setState({ active: true });
    vi.useFakeTimers();
    try {
      renderOverlay();
      // 6 auto attempts (~60s) then the 7th interval trips the cap and switches to manual-only.
      act(() => {
        vi.advanceTimersByTime(70_000);
      });
      expect(screen.getByText('errorScreen.maintenance.autoStopped')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches to the maintenance variant when connectivity returns but the server is still down', async () => {
    setOnline(false);
    checkHealth.mockResolvedValue(false);
    useOutageStore.setState({ active: true });
    renderOverlay();
    expect(screen.getByText('errorScreen.offline.autoWaiting')).toBeInTheDocument();

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() =>
      expect(screen.getByText('errorScreen.maintenance.autoRetrying')).toBeInTheDocument(),
    );
  });

  it('switches to the offline variant when the browser goes offline', () => {
    setOnline(true);
    useOutageStore.setState({ active: true });
    renderOverlay();
    expect(screen.getByText('errorScreen.maintenance.autoRetrying')).toBeInTheDocument();

    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByText('errorScreen.offline.autoWaiting')).toBeInTheDocument();
  });

  it('raises the overlay on its own when the browser fires an offline event', () => {
    renderOverlay();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(useOutageStore.getState().active).toBe(true);
  });

  it('locks scroll, moves focus in, traps Tab, and restores on close (focusable content)', async () => {
    setOnline(false); // offline => the retry button is enabled and therefore focusable
    useOutageStore.setState({ active: true });
    const { unmount } = renderOverlay();

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    expect(document.body.style.overflow).toBe('hidden');
    const button = screen.getByRole('button');
    expect(document.activeElement).toBe(button);

    // A non-Tab key is ignored by the trap.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // Give the trap a SECOND focusable so both wrap directions and the pass-through middle case
    // are exercised (the overlay itself only ever renders one).
    const dialog = screen.getByRole('alertdialog');
    const extra = document.createElement('button');
    extra.textContent = 'extra';
    dialog.appendChild(extra);

    // Forward Tab off the last wraps to the first.
    act(() => {
      extra.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(button);

    // Shift+Tab off the first wraps to the last.
    act(() => {
      button.focus();
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(extra);

    // Tab from a first-but-not-last element falls through (native focus move, no wrap).
    act(() => {
      button.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(button);

    // Focus outside the trap is pulled back: Tab -> first, Shift+Tab -> last.
    act(() => {
      extra.blur();
      button.blur();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(button);
    act(() => {
      button.blur();
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(extra);

    dialog.removeChild(extra);
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps focus captured when nothing is focusable yet (button still cooling)', async () => {
    setOnline(true); // online => the button is disabled (cooling down) => no focusable descendant
    useOutageStore.setState({ active: true });
    renderOverlay();

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    // No crash, overlay stays up.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
