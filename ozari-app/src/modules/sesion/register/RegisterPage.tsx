import LogoMark from '@components/LogoMark';
import React, { useMemo, useRef, useState, type MouseEvent } from 'react';
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
import Button from '@components/Button';
import Checkbox from '@components/Checkbox';
import FormError from '@components/FormError';
import { toFormError } from '@utils/apiError';
import useRegister from '../hooks/useRegister';
import useAuthCard from '../hooks/useAuthCard';
import useDesktopAutoFocus from '@hooks/useDesktopAutoFocus';
import { notify } from '@components/notifications/notify';

const RegisterPage: React.FC = () => {
  const { t } = useTranslation();
  const { containerRef, leaveTo } = useAuthCard('register');
  const methods = useForm<RegisterType>({
    resolver: zodResolver(registerSchema),
    defaultValues: registerSchemaDefaultValues,
    mode: 'onTouched',
  });
  const { reset, handleSubmit, formState, register } = methods;
  const { register: registerUser, isPending } = useRegister();
  const autoFocusFirst = useDesktopAutoFocus();
  // Synchronous in-flight lock: blocks a second submit fired in the same frame, before
  // React re-renders with `isPending` (and disables the button). Released on settle.
  const submitLockRef = useRef(false);
  // Server-side submit error (e.g. email already registered), rendered inline above the button.
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const onSubmit = (data: RegisterType) => {
    if (isPending || submitLockRef.current) return;
    submitLockRef.current = true;
    setFormError(undefined); // clear any prior error as we retry
    registerUser(data, {
      onSettled: () => {
        submitLockRef.current = false;
      },
      onSuccess: () => {
        reset();
        // Success is custom: fire the toast (it persists across the route change, since the
        // host is mounted at the router root) and immediately animate back to login — same
        // as clicking the login link, with the toast still visible through the transition.
        notify.success(t('modules.sesion.register.api.registerSuccessToast'), {
          title: t('modules.sesion.register.api.registerSuccessTitle'),
        });
        leaveTo('/sesion/inicio');
      },
      // Route the failure: a validation/duplicate error (400/409/422) renders INLINE above the
      // button; the global concerns (429/5xx/offline) still surface as a toast.
      onError: (error) => {
        const { inline, toast } = toFormError(error, t('modules.sesion.register.api.registerError'));
        if (inline) setFormError(inline);
        if (toast) notify.error(toast);
      },
    });
  };

  // Register intentionally does NOT auto-submit on autofill (auto-creating an account is
  // inappropriate). Autofilled values still sync into the form (so the button enables) via
  // the autofill detection inside CustomInput.

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
                    autoCapitalize="words"
                    autoCorrect="off"
                    spellCheck={false}
                    className="text-lg"
                    label={t('modules.sesion.register.form.fullNameLabel')}
                    placeholder={t('modules.sesion.register.form.fullNamePlaceholder')}
                    aria-label={t('modules.sesion.register.form.fullNameLabel')}
                    name="fullName"
                    autoFocus={autoFocusFirst}
                    icon={<FaUserAlt />}
                  />
                </div>
                <div className="form-element w-full">
                  <CustomInputForm<RegisterType>
                    id="email-input"
                    data-testid="email-input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="text-lg"
                    label={t('modules.sesion.register.form.emailLabel')}
                    placeholder={t('modules.sesion.register.form.emailPlaceholder')}
                    aria-label={t('modules.sesion.register.form.emailLabel')}
                    name="email"
                    icon={<HiOutlineMail />}
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
                    iconTabbable={false}
                    deps={['confirmPassword']}
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
                    iconTabbable={false}
                  />
                </div>
                <div className="form-element w-full">
                  <Checkbox
                    {...register('termsAccepted')}
                    label={t('modules.sesion.register.form.terms')}
                  />
                </div>
                <div className="form-element w-full flex flex-col items-center">
                  <FormError message={formError} id="register-form-error" />
                  <Button
                    type="submit"
                    fullWidth
                    disabled={!formState.isValid}
                    loading={isPending}
                  >
                    {t('modules.sesion.register.form.submitButton')}
                  </Button>
                </div>

                <p className="form-element text-xs text-gray-500 flex flex-col items-center">
                  <span>{t('modules.sesion.register.form.haveAccount')}</span>
                  <button
                    type="button"
                    onClick={handleLogin}
                    className="mt-0.5 cursor-pointer rounded px-1 py-0.5 font-medium text-magenta outline-none transition-colors hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2"
                  >
                    {t('modules.sesion.register.form.loginLink')}{' '}
                    {t('modules.sesion.register.form.here')}
                  </button>
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
            <div className="article-element w-28" role="img" aria-label={t('components.pageLoader.logo')}>
              <LogoMark className="w-full select-none text-charcoal" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default RegisterPage;
