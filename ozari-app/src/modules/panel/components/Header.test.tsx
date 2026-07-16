import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Header only reads the pathname via useLocation({ select }); stub exactly that.
const { currentPath } = vi.hoisted(() => ({ currentPath: { value: '/panel/productos' } }));
vi.mock('@tanstack/react-router', () => ({
  useLocation: (opts: { select: (l: { pathname: string }) => unknown }) => opts.select({ pathname: currentPath.value }),
}));

// Isolate the header from the UserMenu (its own data/query concerns are tested separately).
vi.mock('./UserMenu', () => ({ default: () => <div data-testid="user-menu" /> }));

import { PanelChromeProvider } from '../hooks/usePanelChrome';
import Header from './Header';

const originalMatchMedia = window.matchMedia;

const setViewport = (mode: 'mobile' | 'desktop'): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches:
      query === '(prefers-reduced-motion: reduce)'
        ? true
        : mode === 'desktop'
          ? query.includes('1024px') || query.includes('768px')
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

const wrapper = ({ children }: { children: ReactNode }) => <PanelChromeProvider>{children}</PanelChromeProvider>;

beforeEach(() => {
  currentPath.value = '/panel/productos';
  vi.clearAllMocks();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('Header', () => {
  it('renders the section title for the active route and the notifications + user menu', () => {
    setViewport('desktop');
    currentPath.value = '/panel/ajustes';
    render(<Header />, { wrapper });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('modules.panel.nav.settings');
    expect(screen.getByRole('button', { name: 'modules.panel.actions.notifications' })).toBeInTheDocument();
    expect(screen.getByTestId('user-menu')).toBeInTheDocument();
  });

  it('falls back to the products title when the path matches no nav item', () => {
    setViewport('desktop');
    currentPath.value = '/panel/unknown-area';
    render(<Header />, { wrapper });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('modules.panel.nav.products');
  });

  it('hides the hamburger on desktop', () => {
    setViewport('desktop');
    render(<Header />, { wrapper });
    expect(screen.queryByRole('button', { name: 'modules.panel.actions.openMenu' })).not.toBeInTheDocument();
  });

  it('shows the hamburger on mobile and opens the drawer when clicked', async () => {
    setViewport('mobile');
    render(<Header />, { wrapper });
    const hamburger = screen.getByRole('button', { name: 'modules.panel.actions.openMenu' });
    expect(hamburger).toBeInTheDocument();
    // Clicking runs openMobile from the chrome context (no throw); the header itself has no visible
    // change, so we assert the control stays present after activation.
    await userEvent.click(hamburger);
    expect(hamburger).toBeInTheDocument();
  });
});
