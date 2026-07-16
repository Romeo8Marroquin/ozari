import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Sidebar reads the pathname via useLocation({ select }) and renders TanStack <Link>s. Stub the Link
// as a plain <a> (dropping the router-only `viewTransition` prop so React doesn't warn), and drive
// the pathname through a hoisted holder.
const { currentPath } = vi.hoisted(() => ({ currentPath: { value: '/panel/productos' } }));

// The sidebar derives its visible tabs from the current role (`filterNavByRole`) — drive it
// directly. Admin is the default staff view (sees every tab); the Driver test overrides it.
const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useRole }));
vi.mock('@tanstack/react-router', () => ({
  useLocation: (opts: { select: (l: { pathname: string }) => unknown }) => opts.select({ pathname: currentPath.value }),
  Link: ({
    to,
    children,
    viewTransition,
    ...rest
  }: {
    to: string;
    children: ReactNode;
    viewTransition?: boolean;
    [key: string]: unknown;
  }) => {
    void viewTransition; // router-only prop; drop it so React doesn't warn about an unknown <a> attr
    return (
      <a href={String(to)} {...rest}>
        {children}
      </a>
    );
  },
}));

import { Role } from '@constants/Roles';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { PanelChromeProvider, usePanelChrome } from '../hooks/usePanelChrome';
import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import type { PanelPath } from '../navConfig';
import Sidebar from './Sidebar';

const originalMatchMedia = window.matchMedia;

const setViewport = (mode: 'mobile' | 'tablet' | 'desktop'): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      query === '(prefers-reduced-motion: reduce)'
        ? true
        : mode === 'desktop'
          ? query.includes('1024px') || query.includes('768px')
          : mode === 'tablet'
            ? query.includes('768px')
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

// A tiny control that reaches into the chrome context so drawer tests can open/close the mobile drawer.
const ChromeControl: React.FC = () => {
  const { openMobile } = usePanelChrome();
  return (
    <button type="button" onClick={openMobile} data-testid="open-drawer">
      open
    </button>
  );
};

const renderSidebar = (options: { withControl?: boolean; pending?: PanelPath | null } = {}) => {
  const navigate = vi.fn();
  const value: PanelNav = { navigateTo: navigate as (to: PanelPath) => void, pending: options.pending ?? null };
  const ui = (
    <PanelChromeProvider>
      <PanelNavContext.Provider value={value}>
        {options.withControl && <ChromeControl />}
        <Sidebar />
      </PanelNavContext.Provider>
    </PanelChromeProvider>
  );
  return { navigate, ...render(ui) };
};

/** The soft active-tint layer of a nav link (its first aria-hidden span). */
const tintOf = (link: HTMLElement): HTMLElement => link.querySelector('span[aria-hidden]') as HTMLElement;

beforeEach(() => {
  currentPath.value = '/panel/productos';
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  useRole.mockReturnValue(Role.Admin);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.body.style.overflow = '';
});

describe('Sidebar (inline, desktop/tablet)', () => {
  it('renders the brand, all nav items, and the collapse toggle, marking the active tab', () => {
    setViewport('desktop');
    renderSidebar();

    expect(screen.getByRole('link', { name: 'modules.panel.brand' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(3); // brand + 2 nav items (products, settings)

    const active = screen.getByRole('link', { name: 'modules.panel.nav.products' });
    expect(active).toHaveAttribute('aria-current', 'page');
    const inactive = screen.getByRole('link', { name: 'modules.panel.nav.settings' });
    expect(inactive).not.toHaveAttribute('aria-current');

    expect(screen.getByRole('button', { name: 'modules.panel.actions.collapse' })).toBeInTheDocument();
  });

  it('hides the products tab from a Driver — their nav is settings only (Epic-2A)', () => {
    setViewport('desktop');
    useRole.mockReturnValue(Role.Driver);
    renderSidebar();

    expect(screen.getAllByRole('link')).toHaveLength(2); // brand + settings
    expect(screen.queryByRole('link', { name: 'modules.panel.nav.products' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'modules.panel.nav.settings' })).toBeInTheDocument();
  });

  it('navigates through the panel nav context when an inactive tab is clicked', async () => {
    setViewport('desktop');
    const { navigate } = renderSidebar();
    await userEvent.click(screen.getByRole('link', { name: 'modules.panel.nav.settings' }));
    expect(navigate).toHaveBeenCalledWith('/panel/ajustes');
  });

  it('forwards a click on the active tab too — the controller owns the decision (cancel/no-op)', async () => {
    setViewport('desktop');
    const { navigate } = renderSidebar();
    await userEvent.click(screen.getByRole('link', { name: 'modules.panel.nav.products' }));
    // The sidebar never swallows intent: re-clicking the tab being left is how a user CANCELS an
    // in-flight transition, and the controller no-ops when truly idle on the active tab.
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('lets a modified click fall through to the browser (no intercept)', () => {
    setViewport('desktop');
    const { navigate } = renderSidebar();
    fireEvent.click(screen.getByRole('link', { name: 'modules.panel.nav.settings' }), { ctrlKey: true });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('brand link navigates home through the controller (which no-ops when already home)', async () => {
    setViewport('desktop');
    currentPath.value = '/panel/ajustes'; // not home (home is products)
    const { navigate } = renderSidebar();
    await userEvent.click(screen.getByRole('link', { name: 'modules.panel.brand' }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('brand link always forwards the intent, and ignores modified clicks', async () => {
    setViewport('desktop');
    currentPath.value = '/panel/productos'; // home
    const { navigate } = renderSidebar();
    const brand = screen.getByRole('link', { name: 'modules.panel.brand' });
    await userEvent.click(brand); // plain click → forwarded (controller no-ops when idle at home)
    expect(navigate).toHaveBeenCalledWith('/panel/productos');

    navigate.mockClear();
    fireEvent.click(brand, { metaKey: true }); // modified → falls through
    expect(navigate).not.toHaveBeenCalled();
  });

  it('an in-flight `pending` moves the tint: the tab being left fades, the pill follows the intent', () => {
    setViewport('desktop');
    // Idle on products: its tint is lit.
    const { unmount } = renderSidebar();
    const productsIdle = screen.getByRole('link', { name: 'modules.panel.nav.products' });
    expect(tintOf(productsIdle).className).toContain('opacity-100');
    unmount();

    // Mid-transition products → ajustes: products is "leaving", so its tint drops NOW (with the
    // content exit) while the destination lights up only at the route commit.
    renderSidebar({ pending: '/panel/ajustes' });
    const productsLeaving = screen.getByRole('link', { name: 'modules.panel.nav.products' });
    expect(tintOf(productsLeaving).className).toContain('opacity-0');
  });

  it('a `pending` equal to the active tab does not mark it as leaving', () => {
    setViewport('desktop');
    renderSidebar({ pending: '/panel/productos' });
    const products = screen.getByRole('link', { name: 'modules.panel.nav.products' });
    expect(tintOf(products).className).toContain('opacity-100');
  });

  it('collapse toggle flips the label and persists the preference', async () => {
    setViewport('desktop');
    renderSidebar();
    const toggle = screen.getByRole('button', { name: 'modules.panel.actions.collapse' });
    await userEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'modules.panel.actions.expand' })).toBeInTheDocument();
    expect(Storage.get<boolean>(StorageKeys.PANEL_SIDEBAR_COLLAPSED)).toBe(true);
  });

  it('renders collapsed on tablet (labels clipped, icons named via aria-label)', () => {
    setViewport('tablet');
    renderSidebar();
    // Collapsed → the nav link is named by its aria-label; the collapse toggle offers "expand".
    expect(screen.getByRole('link', { name: 'modules.panel.nav.products' })).toHaveAttribute('title', 'modules.panel.nav.products');
    expect(screen.getByRole('button', { name: 'modules.panel.actions.expand' })).toBeInTheDocument();
  });

  it('hides the active pill when the path matches no nav item', () => {
    setViewport('desktop');
    currentPath.value = '/panel/nowhere';
    renderSidebar();
    // No item is current; the component renders without throwing (pill hidden).
    expect(screen.queryByRole('link', { name: 'modules.panel.nav.products' })).not.toHaveAttribute('aria-current');
  });

  it('navigates from an inactive tab even when nothing is currently active', async () => {
    setViewport('desktop');
    currentPath.value = '/panel/nowhere'; // no active tab → routeActiveKey resolves to null
    const { navigate } = renderSidebar();
    await userEvent.click(screen.getByRole('link', { name: 'modules.panel.nav.products' }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('re-anchors the pill on window resize without throwing', () => {
    setViewport('desktop');
    renderSidebar();
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('link', { name: 'modules.panel.brand' })).toBeInTheDocument();
  });

  it('glides the pill to the new tab when the route changes', () => {
    setViewport('desktop');
    const { rerender } = renderSidebar();
    currentPath.value = '/panel/ajustes';
    rerender(
      <PanelChromeProvider>
        <PanelNavContext.Provider value={{ navigateTo: vi.fn() as (to: PanelPath) => void, pending: null }}>
          <Sidebar />
        </PanelNavContext.Provider>
      </PanelChromeProvider>,
    );
    expect(screen.getByRole('link', { name: 'modules.panel.nav.settings' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('Sidebar (mobile drawer)', () => {
  it('renders a labelled modal dialog drawer with a backdrop', () => {
    setViewport('mobile');
    renderSidebar();
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer).toHaveAttribute('aria-label', 'modules.panel.brand');
    // The backdrop is the sibling rendered right before the drawer.
    expect(drawer.previousElementSibling).toBeTruthy();
  });

  it('opening the drawer moves focus to the close button', async () => {
    setViewport('mobile');
    renderSidebar({ withControl: true });
    await userEvent.click(screen.getByTestId('open-drawer'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'modules.panel.actions.closeMenu' })).toHaveFocus(),
    );
  });

  it('traps Tab within the open drawer (wrap forward, wrap backward, pass-through middle, ignore non-Tab)', async () => {
    setViewport('mobile');
    renderSidebar({ withControl: true });
    await userEvent.click(screen.getByTestId('open-drawer'));

    const drawer = screen.getByRole('dialog');
    const brand = within(drawer).getByRole('link', { name: 'modules.panel.brand' });
    const last = within(drawer).getByRole('link', { name: 'modules.panel.nav.settings' });
    const closeBtn = within(drawer).getByRole('button', { name: 'modules.panel.actions.closeMenu' });

    // Forward Tab off the last focusable wraps to the first.
    last.focus();
    fireEvent.keyDown(drawer, { key: 'Tab' });
    expect(brand).toHaveFocus();

    // Shift+Tab off the first wraps to the last.
    brand.focus();
    fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    // A middle element passes through (no wrap, native focus move).
    closeBtn.focus();
    fireEvent.keyDown(drawer, { key: 'Tab' });
    expect(closeBtn).toHaveFocus();

    // A non-Tab key is ignored.
    last.focus();
    fireEvent.keyDown(drawer, { key: 'ArrowDown' });
    expect(last).toHaveFocus();
  });

  it('closes on a backdrop click and returns focus to the trigger', async () => {
    setViewport('mobile');
    renderSidebar({ withControl: true });
    const opener = screen.getByTestId('open-drawer');
    opener.focus();
    await userEvent.click(opener);

    const drawer = screen.getByRole('dialog');
    fireEvent.click(drawer.previousElementSibling as HTMLElement); // backdrop
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('closes via the drawer close button', async () => {
    setViewport('mobile');
    renderSidebar({ withControl: true });
    await userEvent.click(screen.getByTestId('open-drawer'));
    await userEvent.click(screen.getByRole('button', { name: 'modules.panel.actions.closeMenu' }));
    await waitFor(() => expect(screen.getByTestId('open-drawer')).toHaveFocus());
  });

  it('a nav click inside the drawer navigates and closes it', async () => {
    setViewport('mobile');
    const { navigate } = renderSidebar({ withControl: true });
    await userEvent.click(screen.getByTestId('open-drawer'));
    // Products is the active/home tab, so click Settings (inactive) to trigger a navigation.
    await userEvent.click(screen.getByRole('link', { name: 'modules.panel.nav.settings' }));
    expect(navigate).toHaveBeenCalledWith('/panel/ajustes');
    await waitFor(() => expect(screen.getByTestId('open-drawer')).toHaveFocus());
  });
});
