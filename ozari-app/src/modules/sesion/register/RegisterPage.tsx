import logo from '@assets/svgs/logo.svg';
import React, { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { FaUserAlt } from 'react-icons/fa';
import { HiOutlineMail } from 'react-icons/hi';
import CustomInputForm from '@components/CustomInputForm';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  registerRequiredPatterns,
  registerSchema,
  registerSchemaDefaultValues,
  type RegisterType,
} from './SchemaRegister';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { useTranslation } from 'react-i18next';
import CustomButton from '@components/CustomButton';
import useRegister from '../hooks/useRegister';
import useAuthCard from '../hooks/useAuthCard';

type RegisterStatus = { type: 'success' | 'error'; message: string } | null;

const RegisterPage: React.FC = () => {
  const { t } = useTranslation();
  const { containerRef, leaveTo } = useAuthCard('register');
  const methods = useForm<RegisterType>({
    resolver: zodResolver(registerSchema),
    defaultValues: registerSchemaDefaultValues,
    mode: 'onTouched',
  });
  const { reset, handleSubmit, trigger, formState, register } = methods;
  const { register: registerUser, isPending } = useRegister();
  const [status, setStatus] = useState<RegisterStatus>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(redirectTimer.current), []);

  const onSubmit = (data: RegisterType) => {
    if (isPending) return;
    setStatus(null);
    registerUser(data, {
      onSuccess: () => {
        reset();
        setStatus({ type: 'success', message: t('modules.sesion.register.api.registerSuccess') });
        redirectTimer.current = setTimeout(() => leaveTo('/sesion/inicio'), 1700);
      },
      onError: () => {
        setStatus({ type: 'error', message: t('modules.sesion.register.api.registerError') });
      },
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

  const handleLogin = (e: MouseEvent) => {
    e.preventDefault();
    leaveTo('/sesion/inicio');
  };

  const requiredPatternsContextValue = useMemo(
    () => ({ requiredPatterns: registerRequiredPatterns }),
    [],
  );

  return (
    <div ref={containerRef} className="w-full flex justify-center items-center">
      <section className="principal-card relative w-[min(960px,94vw)] max-w-full md:min-h-[560px] p-8 sm:p-16 bg-white border-none shadow-2xl rounded-2xl gap-16 md:gap-28 flex flex-col md:flex-row items-center justify-center overflow-hidden">
        <div className="rotational-asset absolute inset-0 m-auto blur-lg bg-gradient-to-l md:bg-gradient-to-b from-cream to-blossom"></div>
        <div className="order-2 md:order-1 flex flex-col gap-7 justify-center items-center z-10 w-full max-w-md">
          <h2 className="form-element text-2xl sm:text-3xl font-bold text-black select-none">
            {t('modules.sesion.register.title')}
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
                  <CustomInputForm<RegisterType>
                    id="fullName-input"
                    data-testid="fullName-input"
                    autoComplete="name"
                    className="text-lg"
                    label={t('modules.sesion.register.form.fullNameLabel')}
                    placeholder={t('modules.sesion.register.form.fullNamePlaceholder')}
                    aria-label={t('modules.sesion.register.form.fullNameLabel')}
                    name="fullName"
                    autoFocus
                    icon={<FaUserAlt />}
                  />
                </div>
                <div className="form-element w-full">
                  <CustomInputForm<RegisterType>
                    id="email-input"
                    data-testid="email-input"
                    autoComplete="email"
                    className="text-lg"
                    label={t('modules.sesion.register.form.emailLabel')}
                    placeholder={t('modules.sesion.register.form.emailPlaceholder')}
                    aria-label={t('modules.sesion.register.form.emailLabel')}
                    name="email"
                    icon={<HiOutlineMail />}
                    onInput={handleAutocomplete}
                  />
                </div>
                <div className="form-element w-full">
                  <CustomInputForm<RegisterType>
                    id="password"
                    data-testid="password-input"
                    autoComplete="new-password"
                    className="text-lg"
                    aria-label={t('modules.sesion.register.form.passwordLabel')}
                    placeholder={t('modules.sesion.register.form.passwordPlaceholder')}
                    label={t('modules.sesion.register.form.passwordLabel')}
                    name="password"
                    type="password"
                  />
                </div>
                <div className="form-element w-full">
                  <CustomInputForm<RegisterType>
                    id="confirmPassword"
                    data-testid="confirmPassword-input"
                    autoComplete="new-password"
                    className="text-lg"
                    aria-label={t('modules.sesion.register.form.confirmPasswordLabel')}
                    placeholder={t('modules.sesion.register.form.confirmPasswordPlaceholder')}
                    label={t('modules.sesion.register.form.confirmPasswordLabel')}
                    name="confirmPassword"
                    type="password"
                  />
                </div>
                <label className="form-element w-full flex items-start gap-2 text-xs text-gray-600 select-none">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-magenta"
                    {...register('termsAccepted')}
                  />
                  <span>{t('modules.sesion.register.form.terms')}</span>
                </label>
                <div className="form-element flex flex-col items-center">
                  <CustomButton
                    text={t('modules.sesion.register.form.submitButton')}
                    disabled={!formState.isValid}
                    loading={isPending}
                  />
                </div>

                {status && (
                  <p
                    role="alert"
                    className={`form-element text-xs text-center ${
                      status.type === 'success' ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {status.message}
                  </p>
                )}

                <p className="form-element text-xs text-gray-500 flex flex-col items-center">
                  <span>{t('modules.sesion.register.form.haveAccount')}</span>
                  <span>
                    {t('modules.sesion.register.form.loginLink')}{' '}
                    <a
                      href="/sesion/inicio"
                      onClick={handleLogin}
                      className="text-magenta hover:underline"
                    >
                      {t('modules.sesion.register.form.here')}
                    </a>
                  </span>
                </p>
              </form>
            </FormProvider>
          </RequiredPatternsContext.Provider>
        </div>
        <div className="order-1 md:order-2 flex z-10">
          <div className="flex flex-col items-center justify-center gap-5 md:gap-7">
            <h2 className="article-element text-2xl sm:text-3xl font-bold text-black select-none">
              {t('modules.sesion.register.welcomeMessage')}
            </h2>
            <p className="article-element text-xl text-black select-none text-center max-w-64">
              {t('modules.sesion.register.subtitle')}
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
      </section>
    </div>
  );
};

export default RegisterPage;
