import { StorageKeys } from '@constants/StorageKeys';
import SesionLayout from '@sesion/SesionLayout';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Storage } from '@utils/storage';

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
  component: SesionLayout,
});
