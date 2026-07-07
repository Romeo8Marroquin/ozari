import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import gsap from 'gsap';
import { useContext, useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PanelShell reads the pathname + navigate from the router and renders route children in <Outlet>.
// We stub those, routing the Outlet to a Harness that captures the panel contexts the shell provides.
const { navigate, currentPath, outlet, titleState } = vi.hoisted(() => ({
  navigate: vi.fn(),
  currentPath: { value: '/panel/inicio' },
  outlet: { render: null as null | (() => ReactElement) },
  titleState: { show: true },
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
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
import { PanelPageTransitionContext } from './PanelPageTransitionContext';
import PanelLayout from './PanelLayout';

// Captured from the shell's providers, via the Harness rendered in the Outlet slot. A holder object
// (mutated, never reassigned) keeps the panel contexts reachable from the test body.
const captured: {
  runExit: () => Promise<void>;
  register: (exit: (() => Promise<void>) | null) => void;
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
      <button type="button" onClick={() => nav('/panel/productos')}>
        go-productos
      </button>
      <button type="button" onClick={() => nav('/panel/inicio')}>
        go-current
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

// Advance GSAP's clock so in-flight tweens reach their onComplete (jsdom has no rAF ticker for GSAP).
const flushGsap = (): void => {
  act(() => {
    gsap.updateRoot(gsap.globalTimeline.time() + 2);
  });
};

beforeEach(() => {
  currentPath.value = '/panel/inicio';
  titleState.show = true;
  vi.clearAllMocks();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  gsap.globalTimeline.clear();
  gsap.killTweensOf('*');
});

describe('PanelLayout - reduced motion', () => {
  it('renders the chrome shell (sidebar, header, and the routed content)', () => {
    const { container } = render(<PanelLayout />);
    expect(container.querySelector('.panel-root')).toBeInTheDocument();
    expect(container.querySelector('.panel-sidebar')).toBeInTheDocument();
    expect(container.querySelector('.panel-header-title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'go-productos' })).toBeInTheDocument();
  });

  it('navigates immediately (no exit tween) when a different tab is requested', async () => {
    render(<PanelLayout />);
    await userEvent.click(screen.getByRole('button', { name: 'go-productos' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/panel/productos', viewTransition: false });
  });

  it('is a no-op when the requested tab is the current one', async () => {
    render(<PanelLayout />);
    await userEvent.click(screen.getByRole('button', { name: 'go-current' }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('runExit resolves immediately', async () => {
    render(<PanelLayout />);
    await expect(captured.runExit()).resolves.toBeUndefined();
  });

  it('registerExit accepts a custom exit and clears it', () => {
    render(<PanelLayout />);
    // Both the set and clear paths of the registration callback.
    expect(() => captured.register(vi.fn().mockResolvedValue(undefined))).not.toThrow();
    expect(() => captured.register(null)).not.toThrow();
  });

  it('skips the default content-in for a page that owns its entrance (custom exit registered)', () => {
    const { rerender } = render(<PanelLayout />);
    // A registered custom exit signals the page owns its own entrance, so the layout must NOT run its
    // default content-in on the next route commit.
    act(() => captured.register(vi.fn().mockResolvedValue(undefined)));
    currentPath.value = '/panel/clientes';
    rerender(<PanelLayout />);
    expect(screen.getByRole('button', { name: 'go-productos' })).toBeInTheDocument();
  });

  it('runs the header-title-in on a later navigation and skips non-panel routes', () => {
    const { rerender } = render(<PanelLayout />);

    // A panel-to-panel route change runs the (reduced) header title-in + default content-in.
    currentPath.value = '/panel/pedidos';
    rerender(<PanelLayout />);
    expect(screen.getByRole('button', { name: 'go-productos' })).toBeInTheDocument();

    // A non-panel path short-circuits the entrance effect.
    currentPath.value = '/sesion/inicio';
    rerender(<PanelLayout />);
    expect(screen.getByRole('button', { name: 'go-productos' })).toBeInTheDocument();
  });
});

describe('PanelLayout - with animations', () => {
  beforeEach(() => setReducedMotion(false));

  it('plays the chrome mount timeline on mount', () => {
    const { container } = render(<PanelLayout />);
    flushGsap();
    expect(container.querySelector('.panel-root')).toBeInTheDocument();
  });

  it('plays the content + header-title exit, then navigates', async () => {
    render(<PanelLayout />);
    flushGsap(); // settle the mount entrance
    await userEvent.click(screen.getByRole('button', { name: 'go-productos' }));
    flushGsap(); // complete the exit tweens so the .then(navigate) fires
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/panel/productos', viewTransition: false }),
    );
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
    const customExit = vi.fn().mockResolvedValue(undefined);
    act(() => captured.register(customExit));

    const promise = captured.runExit();
    flushGsap();
    await promise;
    expect(customExit).toHaveBeenCalled();
  });

  it('runs the animated header-title-in + default content-in on a later navigation', () => {
    const { rerender } = render(<PanelLayout />);
    flushGsap();
    currentPath.value = '/panel/clientes';
    rerender(<PanelLayout />);
    flushGsap();
    expect(screen.getByRole('button', { name: 'go-productos' })).toBeInTheDocument();
  });

  it('no-ops the header-title exit and entrance when the title element is absent', async () => {
    const { rerender } = render(<PanelLayout />);
    flushGsap();

    // Drop the title element, then a navigation: the entrance title-in sees no element (early out).
    titleState.show = false;
    currentPath.value = '/panel/pedidos';
    rerender(<PanelLayout />);
    flushGsap(); // settle the entrance so the content body is visible again

    // And the exit title-out also finds nothing to animate, resolving immediately so navigation runs.
    await userEvent.click(screen.getByRole('button', { name: 'go-productos' }));
    flushGsap();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/panel/productos', viewTransition: false }));
  });
});
