import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { closeAllModals } from '@components/modalRegistry';
import { notify } from '@components/notifications/notify';
import { clearAuthState } from '@utils/tokenRefresh';
import { resetForcedLogout, type ForcedLogoutReason } from '@utils/sessionLifecycle';
import { usePanelExit } from '../PanelExitContext';

/** Why the teardown is running: a deliberate `user` sign-out, or an involuntary forced logout. */
export type TeardownReason = 'user' | ForcedLogoutReason;

/**
 * The single logout choreography, shared by the manual "Cerrar sesión" confirm and the forced 401
 * logout — so the two can never drift and an expired session leaves *exactly* as smoothly as a
 * deliberate one. Lives in the panel because it needs the panel's coordinated exit.
 *
 * The order matters:
 *  1. Sweep any open modals (dismissable or not) via the registry.
 *  2. If involuntary, fire the "session expired" notice — notifications are global (survive the
 *     SPA navigation below) and never cleared here, so it rides along onto the login screen.
 *  3. Clear the **token** (`clearAuthState`) BEFORE navigating: the `/sesion` route guard checks it,
 *     and a still-valid token bounces us straight back to `/panel` (the "logout lands on
 *     /panel/productos, blank" bug). This does NOT flash the header — it reads the token only on
 *     re-render, and the exit is imperative GSAP (no re-render).
 *  4. Play the panel exit (mirror of its entrance; instant under reduced motion), THEN navigate to
 *     login via the router — no page reload — where it plays its own mount-in.
 *  5. Clear the **React Query cache** AFTER navigating so the header keeps showing the user through
 *     the exit (no placeholder flash), then re-arm the forced-logout guard. Globals (notifications,
 *     i18n language, the per-device UUID) are deliberately kept.
 */
export function useSessionTeardown(): (reason: TeardownReason) => Promise<void> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runPanelExit = usePanelExit();
  const { t } = useTranslation();

  return useCallback(
    async (reason: TeardownReason): Promise<void> => {
      closeAllModals();

      if (reason === 'expired') notify.warning(t('errors.sessionExpired'));

      // Drop the token BEFORE navigating, or the /sesion guard sees a valid session and redirects
      // straight back into /panel (blank, since the chrome already animated out).
      clearAuthState();

      await runPanelExit();
      await navigate({ to: '/sesion/inicio' });

      queryClient.clear();
      resetForcedLogout();
    },
    [navigate, queryClient, runPanelExit, t],
  );
}
