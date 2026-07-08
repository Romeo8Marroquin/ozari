import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import type { LoginResponseInterface } from '@sesion/interfaces/LoginInterfaces';
import type { LoginType } from '@sesion/login/SchemaLogin';
import { establishSessionFromResponse } from '@utils/session';
import i18next from 'i18next';

function useLogin() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (body: LoginType) => {
      const config = {
        public: true,
        deviceUuid: true,
        // This form renders its own submit errors inline (see LoginPage `onError`), so opt out of
        // the global toast — the page decides inline vs toast per status.
        skipErrorNotification: true,
      };
      const response = await api.post<LoginResponseInterface>('/auth/signin', body, config);
      return response;
    },
    retry: false,
    // A normal login carries the session in the response header; the MFA branch (`mfaRequired`,
    // no header) no-ops here and is picked up by LoginPage. Session setup is shared with the MFA
    // second step via `establishSessionFromResponse`.
    onSuccess: (response) => establishSessionFromResponse(response, queryClient),
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
