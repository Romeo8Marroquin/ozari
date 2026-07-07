import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import type { RegisterResponseInterface } from '@sesion/interfaces/LoginInterfaces';
import type { RegisterType } from '@sesion/register/SchemaRegister';
import i18next from 'i18next';

function useRegister() {
  const mutation = useMutation({
    mutationFn: async (body: RegisterType) => {
      // This form renders its own submit errors inline (see RegisterPage `onError`), so opt out of
      // the global toast — the page decides inline vs toast per status.
      const config = { public: true, skipErrorNotification: true };
      const response = await api.post<RegisterResponseInterface>('/auth/user', body, config);
      return response;
    },
    retry: false,
    onError: (e) => {
      console.error(i18next.t('modules.sesion.register.api.registerError'), e);
    },
  });

  return {
    register: mutation.mutate,
    isPending: mutation.isPending,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
    reset: mutation.reset,
  };
}

export default useRegister;
