import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import type { LoginResponseInterface } from '@sesion/interfaces/LoginInterfaces';
import type { LoginType } from '@sesion/login/SchemaLogin';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { setupRefreshTimer } from '@utils/tokenRefresh';
import i18next from 'i18next';
import { QueryKeys } from '@constants/QueryKeys';

function useLogin() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (body: LoginType) => {
      const config = {
        public: true,
        deviceUuid: true,
      };
      const response = await api.post<LoginResponseInterface>('/auth/signin', body, config);
      return response;
    },
    retry: false,
    onSuccess: (response) => {
      const bearerToken = response.headers['authorization'];
      if (bearerToken) {
        const token = bearerToken.split(' ')[1];
        Storage.set(StorageKeys.TOKEN, token);

        // Store the CSRF token issued alongside the session (response header). Needed for
        // every later state-changing call (refresh, signout, change-password, MFA).
        const csrfToken = response.headers['x-csrf-token'];
        if (csrfToken) Storage.set(StorageKeys.CSRF, csrfToken);

        queryClient.invalidateQueries({ queryKey: [QueryKeys.ME] });

        // Setup proactive token refresh timer
        setupRefreshTimer(token);
      }
    },
    onError: (e) => {
      console.error(i18next.t('modules.sesion.login.api.loginError'), e);
    },
  });

  return {
    login: mutation.mutate,
    loginAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    data: mutation.data,
    isSuccess: mutation.isSuccess,
  };
}

export default useLogin;
