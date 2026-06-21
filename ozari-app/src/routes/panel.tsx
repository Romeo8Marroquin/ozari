import { StorageKeys } from '@constants/StorageKeys';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Storage } from '@utils/storage';
import { isTokenValid } from '@utils/jwt';
import { refreshAccessToken } from '@utils/tokenRefresh';
import PanelLayout from '../modules/panel/PanelLayout';

export const Route = createFileRoute('/panel')({
  beforeLoad: async ({ location }) => {
    const token = Storage.get<string>(StorageKeys.TOKEN);
    let isLogged = isTokenValid(token);

    if (!isLogged) {
      if (token) {
        Storage.remove(StorageKeys.TOKEN);
      }

      const refreshedToken = await refreshAccessToken(false);
      isLogged = isTokenValid(refreshedToken);
    }

    if (!isLogged) {

      throw redirect({
        to: '/sesion/inicio',
        search: {
          redirect: location.href,
        },
      });
    }
  },
  component: PanelLayout,
});
