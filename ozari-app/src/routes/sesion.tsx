import { StorageKeys } from '@constants/StorageKeys';
import SesionLayout from '@sesion/SesionLayout';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Storage } from '@utils/storage';
import { isTokenValid } from '@utils/jwt';
import { sanitizeLoginRedirect } from '@utils/loginRedirect';
import { markSessionProbeDone, shouldSilentProbeSession } from '@utils/sessionLifecycle';
import { refreshAccessToken } from '@utils/tokenRefresh';

// One silent-refresh probe per tab. The access token lives in (per-tab) sessionStorage,
// but the real session is the durable HttpOnly refresh cookie — so a brand-new tab or a
// post-restart visit has an empty sessionStorage yet may still have a live session. We
// must ask the server (the cookie is HttpOnly — JS can't peek). The gate lives in
// `sessionLifecycle` (per-tab module state): we probe once on the tab's first visit to
// the auth screen and skip the round-trip on every later login<->register toggle — AND
// every teardown (`clearAuthState`) consumes the gate too, so arriving here right after
// a logout never probes the session we just revoked.

export const Route = createFileRoute('/sesion')({
  // `?redirect=` is the deep-link memory: the panel guard writes the intended destination here when
  // it bounces an unauthenticated visitor (a shared product link, a bookmarked filter), and the
  // login navigates there after success. It lives in a shareable URL, so it's sanitized to in-panel
  // paths at this single entry point — never trusted raw (see `sanitizeLoginRedirect`).
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const redirect = sanitizeLoginRedirect(search.redirect);
    return redirect === undefined ? {} : { redirect };
  },
  beforeLoad: async ({ location, search }) => {
    const token = Storage.get<string>(StorageKeys.TOKEN);
    let isLogged = isTokenValid(token);

    // No valid access token in this tab — but the refresh cookie may still hold a live
    // session (new tab / reopened browser). Probe it once before showing the login form,
    // so an existing session rehydrates straight into the panel instead of re-prompting.
    if (!isLogged && shouldSilentProbeSession()) {
      markSessionProbeDone();
      if (token) Storage.remove(StorageKeys.TOKEN);
      const refreshedToken = await refreshAccessToken({ silent: true });
      isLogged = isTokenValid(refreshedToken);
    } else if (token && !isLogged) {
      // Stale token, and this tab's probe gate is already consumed — just drop it.
      Storage.remove(StorageKeys.TOKEN);
    }

    if (isLogged) {
      // The password-reset page is reachable WITH a token even while authenticated: the user is
      // resetting their password (completing it revokes every session anyway), so we don't bounce
      // them to the panel. Every OTHER /sesion/* screen sends a logged-in user straight to the panel.
      const resetToken = (location.search as { token?: unknown }).token;
      const isResetWithToken =
        location.pathname === '/sesion/restablecer' &&
        typeof resetToken === 'string' &&
        resetToken.length > 0;
      if (!isResetWithToken) {
        // Honor a pending deep link even when the session rehydrated here (e.g. the tab landed on
        // the login WITH a redirect and the silent probe found a live cookie session). TanStack's
        // typed `to` can't know a runtime-resolved path (`/panel/productos/6`) — the target was
        // already sanitized to an in-panel path by `validateSearch`.
        throw redirect({
          to: (search.redirect ?? '/panel/productos') as never,
        });
      }
    }
  },
  component: SesionLayout,
});
