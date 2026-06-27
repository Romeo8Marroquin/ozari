import logo from '@assets/svgs/logo.svg';
import React, { useMemo, type MouseEvent } from 'react';
import { FaUserAlt } from 'react-icons/fa';
import CustomInputForm from '@components/CustomInputForm';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  loginRequiredPatterns,
  loginSchema,
  loginSchemaDefaultValues,
  type LoginType,
} from './SchemaLogin';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import { notify } from '@components/notifications/notify';
import useLogin from '../hooks/useLogin';
import { useSearch } from '@tanstack/react-router';
import useAuthCard from '../hooks/useAuthCard';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const search = useSearch({ from: '/sesion' });
  const { containerRef, leaveTo, redirectAfterSuccess } = useAuthCard('login');
  const methods = useForm<LoginType>({
    resolver: zodResolver(loginSchema),
    defaultValues: loginSchemaDefaultValues,
    mode: 'onTouched',
  });
  const { reset, handleSubmit, trigger, formState } = methods;
  const { login, isPending } = useLogin();

  const onSubmit = (data: LoginType) => {
    if (isPending) return;
    login(data, {
      onSuccess: (response) => {
        const payload = response.data?.data;
        if (payload && 'mfaRequired' in payload) {
          // 2FA is enabled on this account; the second step isn't wired up yet.
          notify.error(t('modules.sesion.login.api.mfaNotSupported'));
          return;
        }
        // Only proceed once a session actually exists (access token in the header).
        if (response.headers['authorization']) {
          reset();
          redirectAfterSuccess(search.redirect ?? '/panel/productos');
          return;
        }
        notify.error(t('modules.sesion.login.api.loginError'));
      },
      // Backend/network errors (bad credentials, rate limit, 5xx, offline) are surfaced
      // as a friendly toast by the axios interceptor — nothing to handle here.
    });
  };

  const handleAutocomplete = async (event: React.FormEvent<HTMLInputElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (
      nativeEvent.inputType === undefined &&
      nativeEvent.data === undefined &&
      nativeEvent.dataTransfer === undefined &&
      nativeEvent.isComposing === undefined &&
      !formState.isSubmitting
    ) {
      const isValid = await trigger();
      if (isValid) {
        handleSubmit(onSubmit)();
      }
    }
  };

  const handleRegister = (e: MouseEvent) => {
    e.preventDefault();
    leaveTo('/sesion/registro');
  };

  const requiredPatternsContextValue = useMemo(
    () => ({ requiredPatterns: loginRequiredPatterns }),
    [],
  );

  return (
    <div ref={containerRef} className="w-full flex justify-center items-center">
      <section className="principal-card relative w-[min(960px,94vw)] max-w-full md:min-h-[560px] p-8 sm:p-16 bg-white border-none shadow-2xl rounded-2xl gap-16 md:gap-28 flex flex-col md:flex-row items-center justify-center overflow-hidden">
        <div className="rotational-asset absolute inset-0 m-auto blur-lg bg-gradient-to-l md:bg-gradient-to-b from-cream to-blossom"></div>
        <div className="flex z-10">
          <div className="flex flex-col items-center justify-center gap-5 md:gap-7">
            <h2 className="article-element text-2xl sm:text-3xl font-bold text-black select-none">
              {t('modules.sesion.login.welcomeMessage')}
            </h2>
            <p className="article-element text-xl text-black select-none text-center max-w-64">
              {t('modules.sesion.login.subtitle')}
            </p>
            <div className="article-element w-28 h-36 overflow-hidden">
              <img
                src={logo}
                alt={t('components.pageLoader.logo')}
                className="w-full h-full object-cover object-center select-none"
                aria-label={t('components.pageLoader.logo')}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-7 justify-center items-center z-10 w-full max-w-md">
          <h2 className="form-element text-2xl sm:text-3xl font-bold text-black select-none">
            {t('modules.sesion.login.title')}
          </h2>
          <RequiredPatternsContext.Provider value={requiredPatternsContextValue}>
            <FormProvider {...methods}>
              <form
                onSubmit={(event) => {
                  void handleSubmit(onSubmit)(event);
                }}
                className="w-full flex flex-col items-center gap-4 md:gap-5"
              >
                <div className="form-element w-full">
                  <CustomInputForm<LoginType>
                    id="email-input"
                    data-testid="email-input"
                    autoComplete="email"
                    className="text-lg"
                    label={t('modules.sesion.login.form.emailLabel')}
                    placeholder={t('modules.sesion.login.form.emailPlaceholder')}
                    aria-label={t('modules.sesion.login.form.emailLabel')}
                    name="email"
                    icon={<FaUserAlt />}
                    onInput={handleAutocomplete}
                  />
                </div>
                <div className="form-element w-full">
                  <CustomInputForm<LoginType>
                    id="password"
                    data-testid="password-input"
                    autoComplete="current-password"
                    className="text-lg"
                    aria-label={t('modules.sesion.login.form.passwordLabel')}
                    placeholder={t('modules.sesion.login.form.passwordPlaceholder')}
                    label={t('modules.sesion.login.form.passwordLabel')}
                    name="password"
                    type="password"
                    onInput={handleAutocomplete}
                  />
                </div>
                <div className="form-element w-full flex flex-col items-center">
                  <Button
                    type="submit"
                    fullWidth
                    disabled={!formState.isValid}
                    loading={isPending}
                  >
                    {t('modules.sesion.login.form.submitButton')}
                  </Button>
                </div>

                <p className="form-element text-xs text-gray-500 flex flex-col items-center">
                  <span>{t('modules.sesion.login.form.noAccount')}</span>
                  <button
                    type="button"
                    onClick={handleRegister}
                    className="mt-0.5 cursor-pointer rounded px-1 py-0.5 font-medium text-magenta outline-none transition-colors hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2"
                  >
                    {t('modules.sesion.login.form.signUpLink')}{' '}
                    {t('modules.sesion.login.form.here')}
                  </button>
                </p>
              </form>
            </FormProvider>
          </RequiredPatternsContext.Provider>
        </div>
      </section>
    </div>
  );
};

export default LoginPage;
