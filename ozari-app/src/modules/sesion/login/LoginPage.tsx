import logo from '@assets/svgs/logo.svg';
import React, { useMemo, useRef } from 'react';
import { gsap } from 'gsap';
import { FaUserAlt } from 'react-icons/fa';
import { useGSAP } from '@gsap/react';
import CustomInputForm from '@components/CustomInputForm';
import { FormProvider, useForm } from 'react-hook-form';
import { DevTool } from '@hookform/devtools';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  loginRequiredPatterns,
  loginSchema,
  loginSchemaDefaultValues,
  type LoginType,
} from './SchemaLogin';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { useTranslation } from 'react-i18next';
import CustomButton from '@components/CustomButton';
import useLogin from '../../../hooks/useLogin';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const methods = useForm<LoginType>({
    resolver: zodResolver(loginSchema),
    defaultValues: loginSchemaDefaultValues,
    mode: 'onTouched',
  });
  const { trigger, reset, getValues } = methods;
  const { login, isLoading, error } = useLogin();

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.from('.principal-card', {
        opacity: 0,
        y: 10,
        transform: 'scale(0.90)',
        duration: 1,
      });

      tl.from(
        '.rotational-asset',
        {
          rotation: -50,
          opacity: 0,
          duration: 1,
        },
        '<',
      );

      tl.from(
        '.form-element',
        {
          x: 10,
          opacity: 0,
          stagger: 0.15,
          duration: 0.5,
        },
        '>',
      );

      tl.from(
        '.article-element',
        {
          x: -10,
          opacity: 0,
          stagger: 0.15,
          duration: 0.5,
        },
        '<+0.1',
      );
    },
    { scope: containerRef },
  );

  const onSubmit = async () => {
    if (isLoading) return;
    const isValid = await trigger();
    if (!isValid) return;
    try {
      login(getValues());
      reset();
    } catch (err) {
      console.log('Tanstack error:', error);
      console.error('Login failed:', err);
    }
  };

  const handleAutocomplete = async (event: React.FormEvent<HTMLInputElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (
      nativeEvent.inputType === undefined &&
      nativeEvent.data === undefined &&
      nativeEvent.dataTransfer === undefined &&
      nativeEvent.isComposing === undefined &&
      !methods.formState.isSubmitting
    ) {
      const isValid = await methods.trigger();
      if (isValid) {
        methods.handleSubmit(onSubmit)();
      }
    }
  };

  const requiredPatternsContextValue = useMemo(
    () => ({ requiredPatterns: loginRequiredPatterns }),
    [],
  );

  return (
    <div ref={containerRef} className="w-full flex justify-center items-center">
      <section className="principal-card relative p-12 bg-white shadow-xl/15 rounded-xl gap-30 flex overflow-hidden">
        <div className="rotational-asset absolute -inset-1/3 origin-right -rotate-15 -translate-x-1/2 blur-lg bg-gradient-to-b from-blossom to-cream"></div>
        <div className="flex">
          <div className="flex flex-col items-center justify-center gap-6 z-10">
            <h2 className="article-element text-2xl font-bold text-black select-none">
              {t('modules.sesion.login.welcomeMessage')}
            </h2>
            <p className="article-element text-lg text-black select-none text-center max-w-55">
              {t('modules.sesion.login.subtitle')}
            </p>
            <div className="article-element w-24 h-32 overflow-hidden">
              <img
                src={logo}
                alt={t('components.pageLoader.logo')}
                className="w-full h-full object-cover object-center"
                aria-label={t('components.pageLoader.logo')}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-6 justify-center items-center">
          <h2 className="form-element text-2xl font-bold text-black select-none">
            {t('modules.sesion.login.title')}
          </h2>
          <RequiredPatternsContext.Provider value={requiredPatternsContextValue}>
            <FormProvider {...methods}>
              <form
                onSubmit={methods.handleSubmit(onSubmit)}
                className="w-full flex flex-col items-center gap-6"
              >
                <div className="form-element w-full">
                  <CustomInputForm<LoginType>
                    id="email-input"
                    data-testid="email-input"
                    autoComplete="email"
                    label={t('modules.sesion.login.form.emailLabel')}
                    placeholder={t('modules.sesion.login.form.emailPlaceholder')}
                    aria-label={t('modules.sesion.login.form.emailLabel')}
                    name="email"
                    autoFocus
                    icon={<FaUserAlt />}
                    onInput={handleAutocomplete}
                  />
                </div>
                <div className="form-element w-full">
                  <CustomInputForm<LoginType>
                    id="password"
                    data-testid="password-input"
                    autoComplete="current-password"
                    aria-label={t('modules.sesion.login.form.passwordLabel')}
                    placeholder={t('modules.sesion.login.form.passwordPlaceholder')}
                    label={t('modules.sesion.login.form.passwordLabel')}
                    name="password"
                    type="password"
                    onInput={handleAutocomplete}
                  />
                </div>
                <div className="form-element flex flex-col items-center">
                  <CustomButton
                    text={t('modules.sesion.login.form.submitButton')}
                    disabled={!methods.formState.isValid}
                    loading={methods.formState.isSubmitting}
                  />
                </div>

                <p className="form-element text-xs text-gray-500 flex flex-col items-center">
                  <span>{t('modules.sesion.login.form.noAccount')}</span>
                  <span>
                    {t('modules.sesion.login.form.signUpLink')}{' '}
                    <a href="/register" className="text-magenta hover:underline">
                      {t('modules.sesion.login.form.here')}
                    </a>
                  </span>
                </p>
              </form>
            </FormProvider>
          </RequiredPatternsContext.Provider>
        </div>
      </section>
      <DevTool control={methods.control} />
    </div>
  );
};

export default LoginPage;
