import { act, fireEvent, render, screen } from '@testing-library/react';
import gsap from 'gsap';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationToast from './NotificationToast';
import { DEFAULT_MAX_WIDTH, type NotificationVariant } from './notificationConfig';
import { useNotificationStore, type NotificationItem } from './notificationStore';

/**
 * The toast's whole lifecycle (birth, auto-dismiss, exit) is driven by GSAP tweens. jsdom never
 * ticks GSAP's rAF ticker on its own, so we advance GSAP's global clock explicitly with
 * `gsap.updateRoot(now + N)` — jumping far enough forward forces every active tween (and any exit
 * tween a completing tween spawns) to fire its `onComplete`.
 */
const tick = (secs = 5): void => {
  act(() => {
    gsap.updateRoot(gsap.globalTimeline.time() + secs);
  });
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Re-point matchMedia so the component reads a specific reduced-motion answer for a test. */
const setReducedMotion = (reduced: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

/** jsdom reports every element as 0×0; give real dims so the clip-path body branches run. */
const mockLayout = (): void => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 200,
    height: 40,
    top: 0,
    left: 0,
    right: 200,
    bottom: 40,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
};

const makeItem = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1',
  message: 'Mensaje de prueba',
  variant: 'success',
  duration: 5000,
  ...over,
});

/** Seed the store with the item so we can assert dismissal by its disappearance from the queue. */
const seed = (item: NotificationItem): void => {
  useNotificationStore.setState({ notifications: [item] });
};
const queueSize = (): number => useNotificationStore.getState().notifications.length;

beforeEach(() => {
  useNotificationStore.setState({ notifications: [] });
});

afterEach(() => {
  // Drop any tweens still on GSAP's global timeline so they can't advance into the next test.
  gsap.globalTimeline.clear();
  vi.restoreAllMocks();
  setReducedMotion(true); // restore the global setup default
});

describe('NotificationToast', () => {
  it('renders the message, default title and a polite live region for a success toast', () => {
    render(<NotificationToast item={makeItem()} align="right" />);
    const root = screen.getByRole('status');
    expect(root).toHaveAttribute('aria-live', 'polite');
    expect(root).toHaveAttribute('aria-label', 'components.notifications.success. Mensaje de prueba');
    expect(screen.getByText('Mensaje de prueba')).toBeInTheDocument();
    // Default variant title comes from the config's i18n key (t returns the key in tests).
    expect(screen.getByText('components.notifications.success')).toBeInTheDocument();
  });

  it.each<[NotificationVariant, string, string]>([
    ['success', 'status', 'components.notifications.success'],
    ['error', 'alert', 'components.notifications.error'],
    ['warning', 'alert', 'components.notifications.warning'],
    ['info', 'status', 'components.notifications.info'],
  ])('variant %s uses role %s and its default title', (variant, role, titleKey) => {
    render(<NotificationToast item={makeItem({ variant, duration: 0 })} align="left" />);
    expect(screen.getByRole(role)).toHaveAttribute(
      'aria-live',
      role === 'alert' ? 'assertive' : 'polite',
    );
    expect(screen.getByText(titleKey)).toBeInTheDocument();
  });

  it('honours an explicit title and color override', () => {
    render(
      <NotificationToast
        item={makeItem({ title: 'Personalizado', color: '#123456', duration: 0 })}
        align="right"
      />,
    );
    expect(screen.getByText('Personalizado')).toBeInTheDocument();
    // No default title key rendered when a custom title is supplied.
    expect(screen.queryByText('components.notifications.success')).not.toBeInTheDocument();
  });

  it('applies a fixed numeric width when `width` is set', () => {
    render(<NotificationToast item={makeItem({ width: 300, duration: 0 })} align="right" />);
    expect(screen.getByRole('status')).toHaveStyle({ width: '300px' });
  });

  it('applies a string width verbatim (CSS length)', () => {
    render(<NotificationToast item={makeItem({ width: '20rem', duration: 0 })} align="right" />);
    expect(screen.getByRole('status')).toHaveStyle({ width: '20rem' });
  });

  it('falls back to a max-width cap when no width is given', () => {
    render(<NotificationToast item={makeItem({ duration: 0 })} align="right" />);
    const style = screen.getByRole('status').getAttribute('style') ?? '';
    expect(style).toContain('max-width');
    expect(style).toContain(`${DEFAULT_MAX_WIDTH}px`);
  });

  it('auto-dismisses after its duration elapses', () => {
    seed(makeItem({ id: 'auto', duration: 100 }));
    render(<NotificationToast item={makeItem({ id: 'auto', duration: 100 })} align="right" />);
    tick(); // progress bar tween completes -> playExit
    tick(); // reduced-motion exit tween completes -> dismiss
    expect(queueSize()).toBe(0);
  });

  it('never auto-dismisses a sticky (duration 0) toast', () => {
    seed(makeItem({ duration: 0 }));
    render(<NotificationToast item={makeItem({ duration: 0 })} align="right" />);
    tick(20);
    tick(20);
    expect(queueSize()).toBe(1);
  });

  it('dismisses when clicked', () => {
    seed(makeItem({ id: 'click', duration: 0 }));
    render(<NotificationToast item={makeItem({ id: 'click', duration: 0 })} align="right" />);
    fireEvent.click(screen.getByRole('status'));
    tick();
    expect(queueSize()).toBe(0);
  });

  it('ignores a second close while already exiting (idempotent exit)', () => {
    seed(makeItem({ id: 'once', duration: 0 }));
    render(<NotificationToast item={makeItem({ id: 'once', duration: 0 })} align="right" />);
    const root = screen.getByRole('status');
    fireEvent.click(root);
    fireEvent.click(root); // playExit early-returns (exitingRef already set)
    tick();
    expect(queueSize()).toBe(0);
  });

  it.each([['Enter'], [' '], ['Escape']])('closes on the %s key', (key) => {
    seed(makeItem({ id: 'kbd', duration: 0 }));
    render(<NotificationToast item={makeItem({ id: 'kbd', duration: 0 })} align="right" />);
    fireEvent.keyDown(screen.getByRole('status'), { key });
    tick();
    expect(queueSize()).toBe(0);
  });

  it('ignores unrelated keys', () => {
    seed(makeItem({ id: 'kbd2', duration: 0 }));
    render(<NotificationToast item={makeItem({ id: 'kbd2', duration: 0 })} align="right" />);
    fireEvent.keyDown(screen.getByRole('status'), { key: 'a' });
    tick();
    expect(queueSize()).toBe(1);
  });

  it('pauses the auto-dismiss timer on hover and resumes on leave', () => {
    seed(makeItem({ id: 'hover', duration: 100 }));
    render(<NotificationToast item={makeItem({ id: 'hover', duration: 100 })} align="right" />);
    const root = screen.getByRole('status');

    fireEvent.mouseEnter(root); // pause
    tick(20);
    tick(20);
    expect(queueSize()).toBe(1);

    fireEvent.mouseLeave(root); // resume
    tick();
    tick();
    expect(queueSize()).toBe(0);
  });

  it('pauses on focus and resumes on blur', () => {
    seed(makeItem({ id: 'focus', duration: 100 }));
    render(<NotificationToast item={makeItem({ id: 'focus', duration: 100 })} align="right" />);
    const root = screen.getByRole('status');

    fireEvent.focus(root); // pause
    tick(20);
    expect(queueSize()).toBe(1);

    fireEvent.blur(root); // resume
    tick();
    tick();
    expect(queueSize()).toBe(0);
  });

  it('does not resume the timer once the toast is already exiting', () => {
    seed(makeItem({ id: 'exiting', duration: 0 }));
    render(<NotificationToast item={makeItem({ id: 'exiting', duration: 0 })} align="right" />);
    const root = screen.getByRole('status');
    fireEvent.click(root); // begins exit -> exitingRef set
    fireEvent.mouseLeave(root); // resumeTimer must no-op while exiting
    tick();
    expect(queueSize()).toBe(0);
  });

  describe('with motion (non-reduced) and real layout dimensions', () => {
    beforeEach(() => {
      setReducedMotion(false);
      mockLayout();
      // Provide a resolved document.fonts so the late-font re-settle path runs.
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { ready: Promise.resolve() },
      });
    });

    afterEach(() => {
      delete (document as unknown as { fonts?: unknown }).fonts;
    });

    it('plays the birth timeline and settles (right align)', async () => {
      render(<NotificationToast item={makeItem({ id: 'r', duration: 100 })} align="right" />);
      // Flush BEFORE ticking so document.fonts.ready resolves while the birth is still mid-flight
      // (entered === false → the re-settle is skipped).
      await flush();
      tick(); // enter timeline -> render(p) hits the clip-path body branch, then settle()
      await flush();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('skips the settle re-layout if the toast starts exiting mid-birth', () => {
      seed(makeItem({ id: 'mid', duration: 0 }));
      render(<NotificationToast item={makeItem({ id: 'mid', duration: 0 })} align="right" />);
      fireEvent.click(screen.getByRole('status')); // exitingRef set before birth completes
      tick(); // birth onComplete -> settle() sees exitingRef and bails
      tick();
      expect(queueSize()).toBe(0);
    });

    it('plays the birth timeline and settles (left align)', async () => {
      render(<NotificationToast item={makeItem({ id: 'l', duration: 100 })} align="left" />);
      tick();
      await flush();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('plays the full collapse-then-leave exit and dismisses', () => {
      seed(makeItem({ id: 'exit', duration: 0 }));
      render(<NotificationToast item={makeItem({ id: 'exit', duration: 0 })} align="right" />);
      tick(); // finish birth
      fireEvent.click(screen.getByRole('status')); // motion exit timeline
      tick();
      tick();
      expect(queueSize()).toBe(0);
    });
  });

  describe('font-reflow re-settle', () => {
    afterEach(() => {
      delete (document as unknown as { fonts?: unknown }).fonts;
    });

    it('re-settles once late-loading fonts resolve', async () => {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { ready: Promise.resolve() },
      });
      render(<NotificationToast item={makeItem({ duration: 0 })} align="right" />);
      await flush();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('swallows a rejected fonts.ready', async () => {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { ready: Promise.reject(new Error('font error')) },
      });
      render(<NotificationToast item={makeItem({ duration: 0 })} align="right" />);
      await flush();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });
});
