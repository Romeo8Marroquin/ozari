import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import gsap from 'gsap';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `useMe` drives everything on the page — mock it so we can pin loading / error / success states.
const { useMe } = vi.hoisted(() => ({ useMe: vi.fn() }));
vi.mock('../hooks/useMe', () => ({ useMe }));

// Isolate the page from the real change-password dialog: a tiny stub that only proves the
// open/close wiring (its own internals are covered by ChangePasswordModal.test.tsx).
vi.mock('./ChangePasswordModal', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="cpw-modal">
        <button type="button" onClick={onClose}>
          close-cpw
        </button>
      </div>
    ) : null,
}));

// Same isolation for the MFA enable wizard — its internals live in MfaEnableModal.test.
vi.mock('./MfaEnableModal', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="mfa-modal">
        <button type="button" onClick={onClose}>
          close-mfa
        </button>
      </div>
    ) : null,
}));

// …and for the MFA disable dialog — its internals live in MfaDisableModal.test.
vi.mock('./MfaDisableModal', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="mfa-disable-modal">
        <button type="button" onClick={onClose}>
          close-mfa-disable
        </button>
      </div>
    ) : null,
}));

import { PanelPageTransitionContext, type PanelPageMotion } from '../PanelPageTransitionContext';
import SettingsPage from './SettingsPage';

type MeState = {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  refetch?: () => void;
};

const setMe = (state: MeState): (() => void) => {
  const refetch = state.refetch ?? vi.fn();
  useMe.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    refetch,
  });
  return refetch;
};

// Render, capturing the motion pair the page registers with the (mocked) panel layout so we can
// invoke it directly (the real layout calls `exit` on tab-change / logout, `enter` on a cancel).
const renderPage = (): { registeredMotion: () => PanelPageMotion | null } => {
  let motion: PanelPageMotion | null = null;
  const register = (value: PanelPageMotion | null): void => {
    if (value) motion = value;
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PanelPageTransitionContext.Provider value={register}>{children}</PanelPageTransitionContext.Provider>
  );
  render(<SettingsPage />, { wrapper });
  return { registeredMotion: () => motion };
};

// A full matchMedia mock (gsap's matchMedia calls addEventListener, so the bare object won't do).
const setMatchMedia = (reduceMatches: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reduceMatches : !reduceMatches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

let realMatchMedia: typeof window.matchMedia;
beforeEach(() => {
  vi.clearAllMocks();
  realMatchMedia = window.matchMedia; // the setup's reduced-motion mock
});
afterEach(() => {
  window.matchMedia = realMatchMedia; // don't leak an override into the next test's mount
  vi.restoreAllMocks();
});

describe('SettingsPage', () => {
  it('shows the loading skeletons (no cached profile yet)', () => {
    setMe({ data: undefined, isLoading: true, isFetching: true });
    renderPage();

    // The lead text and both section titles/descriptions render as keys.
    expect(screen.getByText('modules.panel.settings.lead')).toBeInTheDocument();
    expect(screen.getByText('modules.panel.settings.account.title')).toBeInTheDocument();
    // The change-password action is always present.
    expect(
      screen.getByRole('button', { name: 'modules.panel.settings.security.password.action' }),
    ).toBeInTheDocument();
    // The disabled MFA toggle is replaced by a skeleton while loading, so no switch yet.
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('renders a populated account with a valid join date and an enabled MFA toggle', async () => {
    setMe({
      data: {
        id: 1,
        fullName: 'Ana María López Pérez',
        email: 'ana@example.com',
        role: 'Admin',
        mfaEnabled: true,
        createdAt: '2026-01-15T00:00:00.000Z',
      },
    });
    renderPage();

    expect(screen.getByText('Ana María López Pérez')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    // Role label key derived from `me.role`.
    expect(screen.getByText('modules.panel.user.roles.Admin')).toBeInTheDocument();
    // Localized join date (es-GT long form) — not blank.
    expect(screen.getByText(/2026/)).toBeInTheDocument();

    const toggle = screen.getByRole('switch');
    // When on, the switch is interactive; its accessible name is the "turn off" action.
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAccessibleName('modules.panel.settings.security.mfa.toggleOff');
    // Activating it opens the disable confirmation (it won't flip until the backend disables), and
    // it must NOT open the enable wizard.
    await userEvent.click(toggle);
    expect(await screen.findByTestId('mfa-disable-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('mfa-modal')).not.toBeInTheDocument();
    // Closing it (the mock's close button → onClose) unmounts the dialog.
    await userEvent.click(screen.getByRole('button', { name: 'close-mfa-disable' }));
    expect(screen.queryByTestId('mfa-disable-modal')).not.toBeInTheDocument();
  });

  it('falls back gracefully for an empty name/email + bad join date, and an off MFA toggle', () => {
    setMe({
      data: {
        id: 2,
        // Undefined (not just empty) exercises the `?? ''` guard before the initials fallback.
        fullName: undefined,
        email: undefined,
        role: 'Client',
        mfaEnabled: false,
        createdAt: 'not-a-real-date',
      },
    });
    renderPage();

    // Empty full name → the fallback-name key is shown.
    expect(screen.getAllByText('modules.panel.user.fallbackName').length).toBeGreaterThan(0);
    // No email span when email is empty.
    expect(screen.queryByText('ana@example.com')).not.toBeInTheDocument();
    // Bad date → memberSince value collapses to the em dash.
    expect(screen.getByText('—')).toBeInTheDocument();

    const toggle = screen.getByRole('switch');
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleName('modules.panel.settings.security.mfa.toggleOn');
  });

  it('shows the cold error state and retries via refetch', async () => {
    const refetch = setMe({ data: undefined, isError: true, isFetching: false });
    renderPage();

    expect(screen.getByText('modules.panel.settings.account.error.message')).toBeInTheDocument();
    const retry = screen.getByRole('button', {
      name: 'modules.panel.settings.account.error.retry',
    });
    await userEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('opens and closes the MFA enable wizard from the off toggle', async () => {
    setMe({
      data: { id: 3, fullName: 'Ana', email: 'a@b.com', role: 'Client', mfaEnabled: false, createdAt: '2026-01-01' },
    });
    renderPage();

    expect(screen.queryByTestId('mfa-modal')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch'));
    expect(screen.getByTestId('mfa-modal')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'close-mfa' }));
    expect(screen.queryByTestId('mfa-modal')).not.toBeInTheDocument();
  });

  it('opens and closes the change-password modal', async () => {
    setMe({
      data: { id: 1, fullName: 'Ana', email: 'a@b.com', role: 'Client', mfaEnabled: false, createdAt: '2026-01-01' },
    });
    renderPage();

    expect(screen.queryByTestId('cpw-modal')).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'modules.panel.settings.security.password.action' }),
    );
    expect(screen.getByTestId('cpw-modal')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'close-cpw' }));
    expect(screen.queryByTestId('cpw-modal')).not.toBeInTheDocument();
  });

  describe('registered page motion', () => {
    it('exit resolves immediately under reduced motion', async () => {
      setMe({ data: { id: 1, fullName: 'Ana', role: 'Client', mfaEnabled: false, createdAt: '2026-01-01' } });
      const { registeredMotion } = renderPage();
      // Global setup reports prefers-reduced-motion: reduce → the exit short-circuits (resolves).
      await expect(registeredMotion()!.exit()).resolves.toBeUndefined();
    });

    it('exit resolves immediately when there are no blocks to animate', async () => {
      setMe({ data: { id: 1, fullName: 'Ana', role: 'Client', mfaEnabled: false, createdAt: '2026-01-01' } });
      const { registeredMotion } = renderPage();

      // No reduced-motion, but no reveal-blocks either → still resolves without touching gsap.to.
      setMatchMedia(false);
      vi.spyOn(gsap.utils, 'selector').mockReturnValue((() => []) as ReturnType<typeof gsap.utils.selector>);
      const toSpy = vi.spyOn(gsap, 'to');

      await expect(registeredMotion()!.exit()).resolves.toBeUndefined();
      expect(toSpy).not.toHaveBeenCalled();
    });

    it('plays the gsap exit and resolves on complete when animating', async () => {
      // Render WITHOUT reduced motion so the page's own entrance also runs.
      setMatchMedia(false);
      setMe({ data: { id: 1, fullName: 'Ana', role: 'Client', mfaEnabled: false, createdAt: '2026-01-01' } });
      const { registeredMotion } = renderPage();

      // Drive the exit animation to completion synchronously so the promise resolves deterministically.
      const toSpy = vi.spyOn(gsap, 'to').mockImplementation((_targets, vars) => {
        (vars as gsap.TweenVars).onComplete?.call(null);
        return {} as gsap.core.Tween;
      });

      await expect(registeredMotion()!.exit()).resolves.toBeUndefined();
      expect(toSpy).toHaveBeenCalled();
    });

    it('enter replays the reveal (snaps under reduced motion) for a cancelled departure', () => {
      setMe({ data: { id: 1, fullName: 'Ana', role: 'Client', mfaEnabled: false, createdAt: '2026-01-01' } });
      const { registeredMotion } = renderPage();
      expect(() => registeredMotion()!.enter({ fromCurrent: true })).not.toThrow();
    });
  });
});
