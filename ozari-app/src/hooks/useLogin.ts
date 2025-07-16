import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '@api/client';
import type { LoginResponseInterface } from '@sesion/interfaces/LoginInterfaces';
import type { LoginType } from '@sesion/login/SchemaLogin';

function useLogin() {
  const loginRequest = useCallback(async (body: LoginType) => {
    const response = await api.post<LoginResponseInterface>('/login', body);
    return response.data;
  }, []);

  const mutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: (e) => {
      console.log('Login successful:', e);
    },
    onError: (e) => {
      console.error('Login error:', e);
    },
  });

  return {
    login: mutation.mutate,
    isLoading: mutation.isPending,
    error: mutation.error,
  };
}

export default useLogin;
