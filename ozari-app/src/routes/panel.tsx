import { StorageKeys } from '@constants/StorageKeys';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Storage } from '@utils/storage';
import PanelLayout from '../modules/panel/PanelLayout';

export const Route = createFileRoute('/panel')({
  beforeLoad: ({ location }) => {
    const isLogged = !!Storage.get(StorageKeys.TOKEN);

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
