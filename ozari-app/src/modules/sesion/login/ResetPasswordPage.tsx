import LogoMark from '@components/LogoMark';
import React, { useMemo, useRef, useState, type MouseEvent } from 'react';
import CustomInputForm from '@components/CustomInputForm';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  resetPasswordDefaultValues,
  resetPasswordSchema,
  resetRequiredPatterns,
  type ResetPasswordType,
} from './SchemaResetPassword';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import FormError from '@components/FormError';
import { toFormError } from '@utils/apiError';
import { notify } from '@components/notifications/notify';
import useAuthCard from '../hooks/useAuthCard';
import useDesktopAutoFocus from '@hooks/useDesktopAutoFocus';
import { useResetPassword } from '../hooks/useResetPassword';

const KEY = 'modules.sesion.reset';

interface ResetPasswordPageProps {
  /** The reset token from the email link (`?token=`); the route guarantees it is present. */
  token: string;
}

/**
 * The standalone reset page reached from the emailed link (`/sesion/restablecer?token=…`). It wears
 * the same auth-card design as register (two columns + the rotating gradient panel via `useAuthCard`),
 * enters with the shared card animation, and on success **morphs to login** (`leaveTo`, the same
 * continuous handoff as the login↔register switch) with a persistent success toast. Errors follow the
 * app doctrine: an invalid/expired token or reused password (generic `400`) is inline; 429/5xx/offline
 * go to the toast/overlay. The token itself is supplied by the route (which redirects to login when
 * absent), so this component always has one.
 */
const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({ token }) => {
  const { t } = useTranslation();
  const { containerRef, leaveTo } = useAuthCard('register');
  const methods = useForm<ResetPasswordType>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: resetPasswordDefaultValues,
    mode: 'onTouched',
  });
  const { reset, handleSubmit, formState } = methods;
  const { resetPassword, isPending } = useResetPassword();
  const autoFocusFirst = useDesktopAutoFocus();
  const submitLockRef = useRef(false);
  // Latched once the reset succeeds and we begin animating to login (mirrors LoginPage): disables the
  // controls through the leave animation. Never reset — the component unmounts on the redirect.
  const [isRedirecting, setIsRedirecting] = useState(false);
  // Server-side submit error (invalid/expired token, reused password), rendered inline — NOT a toast.
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const onSubmit = (data: ResetPasswordType): void => {
    if (isPending || submitLockRef.current) return;
    submitLockRef.current = true;
    setFormError(undefined);
    resetPassword(
      { token, newPassword: data.password, confirmPassword: data.confirmPassword },
      {
        onSettled: () => {
          submitLockRef.current = false;
        },
        onSuccess: () => {
          setIsRedirecting(true);
          reset();
          // The toast persists across the route change (the host is mounted at the router root).
          notify.success(t(`${KEY}.api.successToast`), { title: t(`${KEY}.api.successTitle`) });
          leaveTo('/sesion/inicio');
        },
        // Invalid/expired token, weak/ reused password (400) → inline; 429/5xx/offline → toast/overlay.
        onError: (error) => {
          const { inline, toast } = toFormError(error, t(`${KEY}.api.invalidToken`));
          if (inline) setFormError(inline);
          if (toast) notify.error(toast);
        },
      },
    );
  };

  const handleLogin = (e: MouseEvent) => {
    e.preventDefault();
    leaveTo('/sesion/inicio');
  };

  const requiredPatternsContextValue = useMemo(
    () => ({ requiredPatterns: resetRequiredPatterns }),
    [],
  );

  return (
    <div ref={containerRef} className="w-full flex justify-center items-center">
      <section className="principal-card relative w-[min(960px,94vw)] max-w-full md:min-h-[560px] p-8 sm:p-16 bg-white border-none shadow-2xl rounded-2xl gap-16 md:gap-28 flex flex-col md:flex-row items-center justify-center overflow-hidden">
        <div className="rotational-asset absolute inset-0 m-auto blur-lg bg-gradient-to-l md:bg-gradient-to-b from-cream to-blossom"></div>
        <div className="order-2 md:order-1 flex flex-col gap-7 justify-center items-center z-10 w-full max-w-md">
          <h2 className="form-element text-2xl sm:text-3xl font-bold text-black text-center select-none">
            {t(`${KEY}.title`)}
          </h2>
          <RequiredPatternsContext.Provider value={requiredPatternsContextValue}>
            <FormProvider {...methods}>
              <form
                onSubmit={(event) => void handleSubmit(onSubmit)(event)}
                className="w-full flex flex-col items-center gap-4 md:gap-5"
              >
                <p className="form-element text-sm text-charcoal/60 text-center max-w-xs">
                  {t(`${KEY}.subtitle`)}
                </p>
                <div className="form-element w-full">
                  <CustomInputForm<ResetPasswordType>
                    id="password"
                    data-testid="password-input"
                    autoComplete="new-password"
                    className="text-lg"
                    aria-label={t(`${KEY}.passwordLabel`)}
                    placeholder={t(`${KEY}.passwordPlaceholder`)}
                    label={t(`${KEY}.passwordLabel`)}
                    name="password"
                    type="password"
                    iconTabbable={false}
                    deps={['confirmPassword']}
                    autoFocus={autoFocusFirst}
                    disabled={isRedirecting}
                  />
                </div>
                <div className="form-element w-full">
                  <CustomInputForm<ResetPasswordType>
                    id="confirmPassword"
                    data-testid="confirmPassword-input"
                    autoComplete="new-password"
                    className="text-lg"
                    aria-label={t(`${KEY}.confirmPasswordLabel`)}
                    placeholder={t(`${KEY}.confirmPasswordPlaceholder`)}
                    label={t(`${KEY}.confirmPasswordLabel`)}
                    name="confirmPassword"
                    type="password"
                    iconTabbable={false}
                    disabled={isRedirecting}
                  />
                </div>
                <div className="form-element w-full flex flex-col items-center">
                  <FormError message={formError} id="reset-form-error" />
                  <Button
                    type="submit"
                    fullWidth
                    disabled={!formState.isValid || isRedirecting}
                    loading={isPending}
                  >
                    {t(`${KEY}.submitButton`)}
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={isRedirecting}
                  className="form-element cursor-pointer rounded px-1 py-0.5 text-xs text-gray-500 outline-none transition-colors hover:text-charcoal hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2"
                >
                  {t(`${KEY}.back`)}
                </button>
              </form>
            </FormProvider>
          </RequiredPatternsContext.Provider>
        </div>
        <div className="order-1 md:order-2 flex z-10">
          <div className="flex flex-col items-center justify-center gap-5 md:gap-7">
            <h2 className="article-element text-2xl sm:text-3xl font-bold text-black select-none">
              {t(`${KEY}.welcomeMessage`)}
            </h2>
            <p className="article-element text-xl text-black select-none text-center max-w-64">
              {t(`${KEY}.subtitle`)}
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

export default ResetPasswordPage;
