import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useMe } = vi.hoisted(() => ({ useMe: vi.fn() }));
vi.mock('../hooks/useMe', () => ({ useMe }));

// Isolate from the real logout modal — a stub that only proves the open/close wiring.
vi.mock('./LogoutConfirmModal', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="logout-modal">
        <button type="button" onClick={onClose}>
          close-logout
        </button>
      </div>
    ) : null,
}));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { PanelNavContext } from '../PanelNavContext';
import type { PanelPath } from '../navConfig';
import UserMenu from './UserMenu';

// A minimal, decodable JWT (jwt-decode only base64url-decodes the payload; the signature is ignored).
const b64url = (obj: unknown): string =>
  btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const makeToken = (payload: Record<string, unknown>): string =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;

type MeState = { data?: unknown; isLoading?: boolean; isError?: boolean };

const setMe = (state: MeState): void => {
  useMe.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
  });
};

const renderMenu = (): { navigate: ReturnType<typeof vi.fn> } => {
  const navigate = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PanelNavContext.Provider value={{ navigateTo: navigate as (to: PanelPath) => void, pending: null }}>
      {children}
    </PanelNavContext.Provider>
  );
  render(<UserMenu />, { wrapper });
  return { navigate };
};

const trigger = (): HTMLElement => screen.getByRole('button', { name: /userMenu/ });
const items = (): HTMLElement[] => screen.getAllByRole('menuitem');

const successProfile = {
  id: 1,
  fullName: 'Ana María López Pérez',
  email: 'ana@example.com',
  role: 'Admin' as const,
  mfaEnabled: false,
  createdAt: '2026-01-01',
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('UserMenu', () => {
  it('shows a skeleton and a generic label while the profile loads', () => {
    // No token → tokenRole resolves to undefined (covers the null-token path).
    setMe({ data: undefined, isLoading: true });
    renderMenu();

    const btn = trigger();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-label', 'modules.panel.actions.userMenu');
    // Menu is closed → no menuitems exposed.
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('shows a degraded identity (neutral avatar + token role) on a cold error', () => {
    Storage.set(StorageKeys.TOKEN, makeToken({ userRole: 2 })); // Admin from the token
    setMe({ data: undefined, isError: true });
    renderMenu();

    expect(trigger()).toHaveAttribute('aria-label', 'modules.panel.actions.userMenu');
    // Role label (from the token) is shown; the "couldn't load" copy appears in the menu.
    expect(screen.getAllByText('modules.panel.user.roles.Admin').length).toBeGreaterThan(0);
    expect(screen.getByText('modules.panel.user.loadError')).toBeInTheDocument();
  });

  it('labels the pill with the first name + role and opens/closes the menu on click', async () => {
    // Token present but WITHOUT a userRole → tokenRole undefined, and `me.role` wins anyway.
    Storage.set(StorageKeys.TOKEN, makeToken({ foo: 1 }));
    setMe({ data: successProfile });
    renderMenu();

    const btn = trigger();
    expect(btn).toHaveAttribute(
      'aria-label',
      'modules.panel.actions.userMenuFor', // name is interpolated; setup returns the raw key
    );
    expect(btn).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(items()[0]).toHaveFocus());
    expect(items()).toHaveLength(3);

    // Clicking again toggles it closed.
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens from the trigger with ArrowDown and ArrowUp', async () => {
    setMe({ data: successProfile });
    renderMenu();
    const btn = trigger();
    btn.focus();

    await userEvent.keyboard('{ArrowDown}');
    expect(btn).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(btn); // close
    await userEvent.keyboard('{ArrowUp}');
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('a non-arrow key on the trigger does not open the menu', async () => {
    setMe({ data: successProfile });
    renderMenu();
    const btn = trigger();
    btn.focus();
    await userEvent.keyboard('{Enter}');
    // Enter activates the button's click (toggle) — assert it via keyboard 'a' instead, a no-op.
    await userEvent.click(btn); // normalize to closed
    btn.focus();
    await userEvent.keyboard('a');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('navigates through items with Arrow/Home/End (with wrap-around)', async () => {
    setMe({ data: successProfile });
    renderMenu();
    await userEvent.click(trigger());
    await waitFor(() => expect(items()[0]).toHaveFocus());

    await userEvent.keyboard('{ArrowDown}');
    expect(items()[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(items()[0]).toHaveFocus();
    // Wrap up from the first → last.
    await userEvent.keyboard('{ArrowUp}');
    expect(items()[2]).toHaveFocus();
    // Wrap down from the last → first.
    await userEvent.keyboard('{ArrowDown}');
    expect(items()[0]).toHaveFocus();

    await userEvent.keyboard('{End}');
    expect(items()[2]).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(items()[0]).toHaveFocus();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    setMe({ data: successProfile });
    renderMenu();
    const btn = trigger();
    await userEvent.click(btn);
    await waitFor(() => expect(items()[0]).toHaveFocus());

    await userEvent.keyboard('{Escape}');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveFocus();
  });

  it('closes when Tab moves focus out of the menu', async () => {
    setMe({ data: successProfile });
    renderMenu();
    const btn = trigger();
    await userEvent.click(btn);
    await waitFor(() => expect(items()[0]).toHaveFocus());

    await userEvent.keyboard('{Tab}');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('dismisses on an outside pointer press', async () => {
    setMe({ data: successProfile });
    renderMenu();
    const btn = trigger();
    await userEvent.click(btn);
    await waitFor(() => expect(items()[0]).toHaveFocus());

    await userEvent.click(document.body);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps open on a pointer press inside the menu', async () => {
    setMe({ data: successProfile });
    renderMenu();
    const btn = trigger();
    await userEvent.click(btn);
    const menu = screen.getByRole('menu');
    await userEvent.pointer({ target: within(menu).getByText('modules.panel.user.menu.profile'), keys: '[MouseLeft>]' });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('the "Seguridad" item navigates to the settings tab and closes the menu', async () => {
    setMe({ data: successProfile });
    const { navigate } = renderMenu();
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('menuitem', { name: 'modules.panel.user.menu.security' }));

    expect(navigate).toHaveBeenCalledWith('/panel/ajustes');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('the "Mi perfil" item is a no-op that just closes the menu', async () => {
    setMe({ data: successProfile });
    const { navigate } = renderMenu();
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('menuitem', { name: 'modules.panel.user.menu.profile' }));

    expect(navigate).not.toHaveBeenCalled();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('the "Cerrar sesión" item opens (and can close) the logout confirmation', async () => {
    setMe({ data: successProfile });
    renderMenu();
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('menuitem', { name: 'modules.panel.user.menu.signOut' }));

    expect(screen.getByTestId('logout-modal')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'close-logout' }));
    expect(screen.queryByTestId('logout-modal')).not.toBeInTheDocument();
  });

  it('falls back to the placeholder name and omits the email when the profile is sparse', async () => {
    setMe({ data: { ...successProfile, fullName: '', email: '' } });
    renderMenu();
    await userEvent.click(trigger());

    const menu = screen.getByRole('menu');
    // Identity block shows the fallback-name key; no email row.
    expect(within(menu).getByText('modules.panel.user.fallbackName')).toBeInTheDocument();
    expect(within(menu).queryByText('ana@example.com')).not.toBeInTheDocument();
  });

  it('re-anchors the menu on scroll and resize while open', async () => {
    setMe({ data: successProfile });
    renderMenu();
    await userEvent.click(trigger());
    // Exercise the reflow listeners — they should run without throwing.
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
