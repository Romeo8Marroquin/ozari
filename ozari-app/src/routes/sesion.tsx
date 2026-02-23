import { StorageKeys } from '@constants/StorageKeys';
import SesionLayout from '@sesion/SesionLayout';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Storage } from '@utils/storage';
import { isTokenValid } from '@utils/jwt';

export const Route = createFileRoute('/sesion')({
  beforeLoad: () => {
    const token = Storage.get<string>(StorageKeys.TOKEN);
    const isLogged = isTokenValid(token);

    // Clear invalid/expired token
    if (token && !isLogged) {
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
