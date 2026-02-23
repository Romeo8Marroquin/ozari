import { StorageKeys } from '@constants/StorageKeys';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Storage } from '@utils/storage';
import { isTokenValid } from '@utils/jwt';
import PanelLayout from '../modules/panel/PanelLayout';

export const Route = createFileRoute('/panel')({
  beforeLoad: ({ location }) => {
    const token = Storage.get<string>(StorageKeys.TOKEN);
    const isLogged = isTokenValid(token);

    if (!isLogged) {
      // Clear invalid/expired token
      if (token) {
        Storage.remove(StorageKeys.TOKEN);
      }

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
