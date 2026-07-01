import { StorageKeys } from '@constants/StorageKeys';
import SesionLayout from '@sesion/SesionLayout';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Storage } from '@utils/storage';
import { isTokenValid } from '@utils/jwt';
import { refreshAccessToken } from '@utils/tokenRefresh';

// One silent-refresh probe per tab. The access token lives in (per-tab) sessionStorage,
// but the real session is the durable HttpOnly refresh cookie — so a brand-new tab or a
// post-restart visit has an empty sessionStorage yet may still have a live session. We
// must ask the server (the cookie is HttpOnly — JS can't peek). This flag is module-
// scoped, so it's per-tab: we probe once on the tab's first visit to the auth screen and
// then skip the round-trip on every later login<->register toggle (the cookie state can't
// change between those), keeping the switch animation instant.
let silentRefreshProbed = false;

export const Route = createFileRoute('/sesion')({
  beforeLoad: async () => {
    const token = Storage.get<string>(StorageKeys.TOKEN);
    let isLogged = isTokenValid(token);

    // No valid access token in this tab — but the refresh cookie may still hold a live
    // session (new tab / reopened browser). Probe it once before showing the login form,
    // so an existing session rehydrates straight into the panel instead of re-prompting.
    if (!isLogged && !silentRefreshProbed) {
      silentRefreshProbed = true;
      if (token) Storage.remove(StorageKeys.TOKEN);
      const refreshedToken = await refreshAccessToken(false);
      isLogged = isTokenValid(refreshedToken);
    } else if (token && !isLogged) {
      // Stale token, and we've already probed this tab — just drop it.
      Storage.remove(StorageKeys.TOKEN);
    }

    if (isLogged) {
      throw redirect({
        to: '/panel/productos',
      });
    }
  },
  component: SesionLayout,
});
