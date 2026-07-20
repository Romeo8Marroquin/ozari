import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import gsap from 'gsap';
import { useContext, useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PanelShell reads the pathname + navigate from the router and renders route children in <Outlet>.
// We stub those, routing the Outlet to a Harness that captures the panel contexts the shell provides.
const { navigate, preloadRoute, currentPath, outlet, titleState } = vi.hoisted(() => ({
  navigate: vi.fn(),
  preloadRoute: vi.fn(),
  currentPath: { value: '/panel/productos' },
  outlet: { render: null as null | (() => ReactElement) },
  titleState: { show: true },
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ preloadRoute }),
  useLocation: (opts: { select: (l: { pathname: string }) => unknown }) => opts.select({ pathname: currentPath.value }),
  Outlet: () => (outlet.render ? outlet.render() : <div data-testid="outlet" />),
}));

// Stub the chrome children so the layout is isolated from their data/query concerns. Keep the class
// hooks the layout's GSAP timelines target (`.panel-sidebar`, `.panel-header(-title)`, `.panel-nav-item`).
vi.mock('./components/Header', () => ({
  default: () => (
    <header className="panel-header">
      {titleState.show && <h1 className="panel-header-title">title</h1>}
    </header>
  ),
}));
vi.mock('./components/Sidebar', () => ({
  default: () => (
    <aside className="panel-sidebar">
      <span className="panel-nav-item" />
    </aside>
  ),
}));
vi.mock('./ForcedLogoutListener', () => ({ default: () => null }));

import { PanelExitContext } from './PanelExitContext';
import { PanelNavContext } from './PanelNavContext';
import { PanelPageTransitionContext, type PanelPageMotion } from './PanelPageTransitionContext';
import type { PanelPath } from './navConfig';
import PanelLayout from './PanelLayout';

// A third tab that doesn't exist yet, to exercise a genuine mid-exit RETARGET (A → B while leaving).
const OTHER = '/panel/otros' as PanelPath;

// Captured from the shell's providers, via the Harness rendered in the Outlet slot. A holder object
// (mutated, never reassigned) keeps the panel contexts reachable from the test body.
const captured: {
  runExit: () => Promise<void>;
  register: (motion: PanelPageMotion | null) => void;
} = { runExit: async () => {}, register: () => {} };

const Harness: React.FC = () => {
  const nav = useContext(PanelNavContext);
  const runExit = useContext(PanelExitContext);
  const register = useContext(PanelPageTransitionContext);
  useEffect(() => {
    captured.runExit = runExit;
    captured.register = register;
  }, [runExit, register]);
  return (
    <div>
      <span data-testid="pending">{nav.pending ?? 'none'}</span>
      <button type="button" onClick={() => nav.navigateTo('/panel/ajustes')}>
        nav-ajustes
      </button>
      <button type="button" onClick={() => nav.navigateTo('/panel/productos')}>
        nav-productos
      </button>
      <button type="button" onClick={() => nav.navigateTo(OTHER)}>
        nav-otros
      </button>
      <button type="button" onClick={() => nav.navigateTo('/panel/productos/nuevo')}>
        nav-nuevo
      </button>
    </div>
  );
};
outlet.render = () => <Harness />;

const originalMatchMedia = window.matchMedia;

// The global setup reports reduced-motion. Flip it to run the real GSAP timelines: reduce=false AND
// `(prefers-reduced-motion: no-preference)`=true (the gate on the mount `gsap.matchMedia`).
const setReducedMotion = (reduce: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      query === '(prefers-reduced-motion: reduce)'
        ? reduce
        : query === '(prefers-reduced-motion: no-preference)'
          ? !reduce
          : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

// Advance GSAP's clock so in-flight tweens progress (jsdom has no rAF ticker for GSAP). The default
// jump (2s) completes anything; a small step leaves the ~0.2s exits mid-flight to interrupt them.
const flushGsap = (seconds = 2): void => {
  act(() => {
    gsap.updateRoot(gsap.globalTimeline.time() + seconds);
  });
};

beforeEach(() => {
  currentPath.value = '/panel/productos';
  titleState.show = true;
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  preloadRoute.mockResolvedValue(undefined);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  gsap.globalTimeline.clear();
  gsap.killTweensOf('*');
  gsap.ticker.wake();
});

describe('PanelLayout - reduced motion', () => {
  it('renders the chrome shell (sidebar, header, and the routed content)', () => {
    const { container } = render(<PanelLayout />);
    expect(container.querySelector('.panel-root')).toBeInTheDocument();
    expect(container.querySelector('.panel-sidebar')).toBeInTheDocument();
    expect(container.querySelector('.panel-header-title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'nav-ajustes' })).toBeInTheDocument();
  });

  it('navigates immediately (no exit tween) when a different tab is requested', async () => {
    render(<PanelLayout />);
    await userEvent.click(screen.getByRole('button', { name: 'nav-ajustes' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/panel/ajustes', viewTransition: false });
  });

  it('is a no-op when the requested tab is the current one', async () => {
    render(<PanelLayout />);
    await userEvent.click(screen.getByRole('button', { name: 'nav-productos' }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('runExit resolves immediately', async () => {
    render(<PanelLayout />);
    await expect(captured.runExit()).resolves.toBeUndefined();
  });

  it('registerMotion accepts a custom motion pair and clears it', () => {
    render(<PanelLayout />);
    // Both the set and clear paths of the registration callback.
    expect(() =>
      captured.register({ enter: vi.fn(), exit: vi.fn().mockResolvedValue(undefined) }),
    ).not.toThrow();
    expect(() => captured.register(null)).not.toThrow();
  });

  it('skips the default content-in for a page that owns its entrance (custom motion registered)', () => {
    const { rerender } = render(<PanelLayout />);
    // Registered custom motion signals the page owns its own entrance, so the layout must NOT run its
    // default content-in on the next route commit.
    act(() => captured.register({ enter: vi.fn(), exit: vi.fn().mockResolvedValue(undefined) }));
    currentPath.value = '/panel/ajustes';
    rerender(<PanelLayout />);
    expect(screen.getByRole('button', { name: 'nav-ajustes' })).toBeInTheDocument();
  });

  it('runs the header-title-in on a later navigation and skips non-panel routes', () => {
    const { rerender } = render(<PanelLayout />);

    // A panel-to-panel route change runs the (reduced) header title-in + default content-in.
    currentPath.value = '/panel/ajustes';
    rerender(<PanelLayout />);
    expect(screen.getByRole('button', { name: 'nav-ajustes' })).toBeInTheDocument();

    // A non-panel path short-circuits the entrance effect.
    currentPath.value = '/sesion/inicio';
    rerender(<PanelLayout />);
    expect(screen.getByRole('button', { name: 'nav-ajustes' })).toBeInTheDocument();
  });
});

describe('PanelLayout - with animations', () => {
  beforeEach(() => {
    setReducedMotion(false);
    // Freeze GSAP's clock: jsdom has no rAF, but gsap falls back to a setTimeout ticker whose
    // WALL-CLOCK progress could complete a deliberately "mid-flight" tween on a slow run (a flaky
    // retarget/cancel test). Sleeping the ticker makes flushGsap() the only source of time.
    gsap.ticker.sleep();
  });

  it('plays the chrome mount timeline on mount', () => {
    const { container } = render(<PanelLayout />);
    flushGsap();
    expect(container.querySelector('.panel-root')).toBeInTheDocument();
  });

  it('holds the header title on a same-section move; a cross-section retarget takes it out late', async () => {
    const { container } = render(<PanelLayout />);
    flushGsap();
    const title = container.querySelector<HTMLElement>('.panel-header-title') as HTMLElement;

    // Grid → create form: same products section — the title must not be tweened at all.
    await userEvent.click(screen.getByRole('button', { name: 'nav-nuevo' }));
    flushGsap(0.05); // mid-exit
    expect(title.style.opacity === '' || Number(title.style.opacity) === 1).toBe(true);

    // Retarget the running exit to ANOTHER section: the title exits now (late, in step).
    await userEvent.click(screen.getByRole('button', { name: 'nav-ajustes' }));
    flushGsap(0.05);
    expect(Number(title.style.opacity)).toBeLessThan(1);

    flushGsap();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/panel/ajustes', viewTransition: false }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('plays the content + header-title exit, publishes pending, then navigates once', async () => {
    render(<PanelLayout />);
    flushGsap(); // settle the mount entrance
    await userEvent.click(screen.getByRole('button', { name: 'nav-ajustes' }));
    // The intent is published to the chrome the moment the click lands (pill/tint follow it).
    expect(screen.getByTestId('pending')).toHaveTextContent('/panel/ajustes');
    expect(navigate).not.toHaveBeenCalled(); // exit still playing
    flushGsap(); // complete the exit tweens so the .then(navigate) fires
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/panel/ajustes', viewTransition: false }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
  });

  it('an idle click on the current tab is a no-op (nothing to leave, nothing pending)', async () => {
    render(<PanelLayout />);
    flushGsap();
    await userEvent.click(screen.getByRole('button', { name: 'nav-productos' }));
    flushGsap();
    await act(async () => {});
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
  });

  // `retry`: the two mid-flight-interrupt tests below advance a frozen GSAP clock in tiny steps;
  // under FULL-suite load the runner occasionally schedules them badly and they flake (they always
  // pass in isolation). A retry keeps the signal — a real regression still fails 3× in a row.
  it('re-clicking the SAME destination mid-exit never restarts or double-navigates', { retry: 2 }, async () => {
    render(<PanelLayout />);
    flushGsap();
    await userEvent.click(screen.getByRole('button', { name: 'nav-ajustes' }));
    flushGsap(0.1); // mid-exit
    await userEvent.click(screen.getByRole('button', { name: 'nav-ajustes' }));
    flushGsap();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/panel/ajustes', viewTransition: false }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('RETARGETS a mid-exit transition: latest intent wins, one navigate to the new destination', { retry: 2 }, async () => {
    render(<PanelLayout />);
    flushGsap();
    await userEvent.click(screen.getByRole('button', { name: 'nav-ajustes' }));
    flushGsap(0.1); // mid-exit
    await userEvent.click(screen.getByRole('button', { name: 'nav-otros' }));
    expect(screen.getByTestId('pending')).toHaveTextContent(OTHER);
    flushGsap();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: OTHER, viewTransition: false }));
    expect(navigate).toHaveBeenCalledTimes(1);
    // Both intents were warmed while the exit played (code-split chunks download during the exit).
    expect(preloadRoute).toHaveBeenCalledWith({ to: '/panel/ajustes' });
    expect(preloadRoute).toHaveBeenCalledWith({ to: OTHER });
  });

  it('abandons the pending tab when a HISTORY commit lands mid-exit (browser back wins)', { retry: 2 }, async () => {
    const { rerender } = render(<PanelLayout />);
    flushGsap();
    await userEvent.click(screen.getByRole('button', { name: 'nav-ajustes' }));
    flushGsap(0.1); // mid-exit
    // A popstate commits a different route while the exit plays (the ROUTER changed the pathname —
    // not our controller, whose navigate hasn't fired yet): the pop is the newer intent.
    currentPath.value = '/panel/productos/7';
    rerender(<PanelLayout />);
    flushGsap(); // let the exit finish — its completion must now abandon, not stomp the pop
    await act(async () => {});
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
  });

  it('a failed route preload never blocks the transition (best-effort)', async () => {
    preloadRoute.mockRejectedValue(new Error('offline chunk'));
    render(<PanelLayout />);
    flushGsap();
    await userEvent.click(screen.getByRole('button', { name: 'nav-ajustes' }));
    flushGsap();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/panel/ajustes', viewTransition: false }),
    );
  });

  it('CANCELS a mid-exit transition when the current tab is re-clicked: no navigation, content resumes', async () => {
    render(<PanelLayout />);
    flushGsap();
    await userEvent.click(screen.getByRole('button', { name: 'nav-ajustes' }));
    flushGsap(0.1); // mid-exit
    await userEvent.click(screen.getByRole('button', { name: 'nav-productos' })); // = current path
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
    flushGsap();
    // Give any abandoned promise chain a chance to (incorrectly) navigate before asserting it didn't.
    await act(async () => {});
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a cancelled exit resumes a CUSTOM page entrance from the current frame', async () => {
    render(<PanelLayout />);
    flushGsap();
    const motion: PanelPageMotion = { enter: vi.fn(), exit: vi.fn().mockResolvedValue(undefined) };
    act(() => captured.register(motion));

    await userEvent.click(screen.getByRole('button', { name: 'nav-ajustes' }));
    expect(motion.exit).toHaveBeenCalledTimes(1);
    // The custom exit resolved instantly, but the header-title tween keeps the run in flight.
    await userEvent.click(screen.getByRole('button', { name: 'nav-productos' })); // cancel
    expect(motion.enter).toHaveBeenCalledWith({ fromCurrent: true });
    flushGsap();
    await act(async () => {});
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a click during the incoming ENTRANCE starts a fresh exit to the new target', async () => {
    const { rerender } = render(<PanelLayout />);
    flushGsap();
    // Commit a route change; the entrance (default content-in + title-in) starts playing.
    currentPath.value = '/panel/ajustes';
    rerender(<PanelLayout />);
    flushGsap(0.1); // mid-entrance
    await userEvent.click(screen.getByRole('button', { name: 'nav-productos' }));
    flushGsap();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/panel/productos', viewTransition: false }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('logout (runExit) abandons an in-flight tab navigation and still resolves', async () => {
    render(<PanelLayout />);
    flushGsap();
    await userEvent.click(screen.getByRole('button', { name: 'nav-ajustes' }));
    flushGsap(0.1); // mid-exit
    let exitPromise: Promise<void> = Promise.resolve();
    act(() => {
      exitPromise = captured.runExit();
    });
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
    flushGsap();
    await expect(exitPromise).resolves.toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('runExit peels the chrome away and resolves', async () => {
    render(<PanelLayout />);
    flushGsap();
    const promise = captured.runExit();
    flushGsap();
    await expect(promise).resolves.toBeUndefined();
  });

  it('a page-registered custom exit is used instead of the default body-out', async () => {
    render(<PanelLayout />);
    flushGsap();
    const motion: PanelPageMotion = { enter: vi.fn(), exit: vi.fn().mockResolvedValue(undefined) };
    act(() => captured.register(motion));

    const promise = captured.runExit();
    flushGsap();
    await promise;
    expect(motion.exit).toHaveBeenCalled();
  });

  it('runs the animated header-title-in + default content-in on a later navigation', () => {
    const { rerender } = render(<PanelLayout />);
    flushGsap();
    currentPath.value = '/panel/ajustes';
    rerender(<PanelLayout />);
    flushGsap();
    expect(screen.getByRole('button', { name: 'nav-ajustes' })).toBeInTheDocument();
  });

  it('no-ops the header-title exit and entrance when the title element is absent', async () => {
    const { rerender } = render(<PanelLayout />);
    flushGsap();

    // Drop the title element, then a navigation: the entrance title-in sees no element (early out).
    titleState.show = false;
    currentPath.value = '/panel/ajustes';
    rerender(<PanelLayout />);
    flushGsap(); // settle the entrance so the content body is visible again

    // And the exit title-out also finds nothing to animate, resolving immediately so navigation runs.
    // Current is now /panel/ajustes, so navigating to /panel/productos is a real (different) move.
    await userEvent.click(screen.getByRole('button', { name: 'nav-productos' }));
    flushGsap();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/panel/productos', viewTransition: false }));
  });
});
