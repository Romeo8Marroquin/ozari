import LogoMark from '@components/LogoMark';
import React, { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
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
import FormError from '@components/FormError';
import { notify } from '@components/notifications/notify';
import { toFormError } from '@utils/apiError';
import useLogin from '../hooks/useLogin';
import { useSearch } from '@tanstack/react-router';
import useAuthCard from '../hooks/useAuthCard';
import useDesktopAutoFocus from '@hooks/useDesktopAutoFocus';
import { hasUserGestured } from '@hooks/useUserGesture';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const search = useSearch({ from: '/sesion' });
  const { containerRef, leaveTo, redirectAfterSuccess } = useAuthCard('login');
  const methods = useForm<LoginType>({
    resolver: zodResolver(loginSchema),
    defaultValues: loginSchemaDefaultValues,
    mode: 'onTouched',
  });
  const { reset, handleSubmit, trigger, getValues, setValue } = methods;
  const { login, isPending } = useLogin();
  // Latched once a real session exists and we begin animating to the panel. The form is
  // cleared at that point (so it's invalid), which on register disables the button via
  // `formState.isValid`. Login can't gate the button by validity (mobile/iOS autofill
  // leaves `isValid` stale-false and would swallow the tap — see `submitForm`), so this
  // flag stands in for "form cleared, redirecting" and disables the button explicitly.
  // It's a DISABLE, not a loader: the spinner reflects only the in-flight backend call.
  // Never reset — the component unmounts on the redirect.
  const [isRedirecting, setIsRedirecting] = useState(false);
  // Server-side submit error (bad credentials etc.), rendered inline above the button — NOT a toast.
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const autoFocusFirst = useDesktopAutoFocus();
  const formRef = useRef<HTMLFormElement>(null);
  // Synchronous in-flight lock: blocks a second submit fired in the same frame, before
  // React re-renders with `isPending` (and disables the button). Released on settle.
  const submitLockRef = useRef(false);
  // Last credentials we auto-submitted, so leaving a field again with the SAME values (e.g.
  // re-focusing then blurring after a failed login) doesn't re-submit them.
  const lastSubmitRef = useRef({ email: '', password: '' });
  // Pending blur-submit check, debounced so a multi-field autofill (email + password fill in
  // quick succession, each blurring) settles into a single evaluation. Cleared on unmount.
  const blurSubmitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(blurSubmitTimerRef.current), []);
  // Set when the browser / a password manager autofills a field. Auto-submit-on-blur is
  // limited to this case, so a user typing by hand (no password manager) is never auto-logged
  // in by tabbing out of a completed form — they still click the button.
  const autofilledRef = useRef(false);
  const handleAutofill = () => {
    autofilledRef.current = true;
  };

  // Pull the live DOM values into the form before validating/submitting. A mobile password
  // manager — and especially iOS AutoFill, which keeps the filled value MASKED from JS until a
  // user gesture (and the submit tap IS that gesture) — can populate the inputs without React
  // ever seeing an `onChange`, leaving the form's state empty. Reading the DOM here makes
  // submit work regardless of whether our autofill detection fired, so the button is never a
  // dead end on a real device.
  const syncDomValues = () => {
    const form = formRef.current;
    if (!form) return;
    (['email', 'password'] as const).forEach((field) => {
      const el = form.elements.namedItem(field);
      if (el instanceof HTMLInputElement) setValue(field, el.value, { shouldValidate: false });
    });
  };

  // The form's submit path: sync the DOM, then let RHF validate. If invalid, RHF flips
  // `isSubmitted` and the errors surface (the button always responds); if valid, `onSubmit`
  // runs. The button is intentionally NOT disabled by validity — a stale `isValid` (mobile
  // autofill not yet synced) must never swallow the tap.
  const submitForm = () => {
    syncDomValues();
    void handleSubmit(onSubmit)();
  };

  // Submit on POINTERDOWN, not just the click. On a real phone, tapping the button while the
  // password keyboard is open blurs the field → the keyboard dismisses → the vertically-centered
  // card shifts up → at `touchend` the finger is no longer over the button, so the browser
  // CANCELS the click and the form never submits (this is why it failed only on login — its last
  // field is the password — and only on a real device, where a virtual keyboard actually exists).
  // Pointerdown fires on the button before any shift, and while the value is still readable.
  // `submitForm`/`onSubmit` are idempotent via the in-flight lock, so the trailing click (when it
  // isn't cancelled) won't double-submit.
  const handleSubmitPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary) return; // ignore secondary touches / non-primary pointers
    submitForm();
  };

  const onSubmit = (data: LoginType) => {
    if (isPending || submitLockRef.current) return;
    submitLockRef.current = true;
    setFormError(undefined); // clear any prior error as we retry
    login(data, {
      onSettled: () => {
        submitLockRef.current = false;
      },
      onSuccess: (response) => {
        const payload = response.data?.data;
        if (payload && 'mfaRequired' in payload) {
          // 2FA is enabled on this account; the second step isn't wired up yet.
          notify.error(t('modules.sesion.login.api.mfaNotSupported'));
          return;
        }
        // Only proceed once a session actually exists (access token in the header).
        if (response.headers['authorization']) {
          setIsRedirecting(true);
          reset();
          redirectAfterSuccess(search.redirect ?? '/panel/productos');
          return;
        }
        notify.error(t('modules.sesion.login.api.loginError'));
      },
      // Route the failure: a validation/credential error (400/401) renders INLINE above the button;
      // the global concerns (429/5xx/offline) still surface as a toast.
      onError: (error) => {
        const { inline, toast } = toFormError(error, t('modules.sesion.login.api.invalidCredentials'));
        if (inline) setFormError(inline);
        if (toast) notify.error(toast);
      },
    });
  };

  // Auto-submit when the user LEAVES an autofilled field, GitHub-style. The trigger is a blur
  // (the user "touched" a field: focused it, then moved on), NOT the fill itself — so *focusing*
  // a field and the browser autofilling it does nothing; only finishing with it submits. This
  // distinguishes "the native menu popped up on click" (no submit) from "the user picked an
  // account" (focus moves off the field → blur → submit). It fires only when ALL hold:
  //   1. the blur is on an actual input (not the submit/switch buttons),
  //   2. a password manager / the browser autofilled (manual typing never auto-submits),
  //   3. the user has genuinely gestured — so a page-load autofill + a programmatic blur (e.g.
  //      a password manager shuffling focus after our autofocus) never submits,
  //   4. the form is valid, and
  //   5. the credentials CHANGED since the last auto-submit, so blurring again with the same
  //      values (e.g. after a failed login) doesn't re-fire — but picking another account does.
  // Deferred so a two-field autofill (which blurs the first field as it fills the second) is
  // evaluated once, after both values have landed. Routed through the in-flight lock.
  const handleFieldBlur = (event: React.FocusEvent<HTMLFormElement>) => {
    if ((event.target as HTMLElement).tagName !== 'INPUT') return;
    clearTimeout(blurSubmitTimerRef.current);
    blurSubmitTimerRef.current = setTimeout(async () => {
      if (!autofilledRef.current || !hasUserGestured() || isPending || submitLockRef.current)
        return;
      syncDomValues(); // capture an autofill the controlled inputs may have missed
      const { email, password } = getValues();
      if (email === lastSubmitRef.current.email && password === lastSubmitRef.current.password)
        return;
      if (!(await trigger())) return;
      lastSubmitRef.current = { email, password };
      void handleSubmit(onSubmit)();
    }, 80);
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
            <div className="article-element w-28" role="img" aria-label={t('components.pageLoader.logo')}>
              <LogoMark className="w-full select-none text-charcoal" />
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
                ref={formRef}
                onSubmit={(event) => {
                  event.preventDefault();
                  submitForm();
                }}
                onBlur={handleFieldBlur}
                className="w-full flex flex-col items-center gap-4 md:gap-5"
              >
                <div className="form-element w-full">
                  <CustomInputForm<LoginType>
                    id="email-input"
                    data-testid="email-input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="text-lg"
                    label={t('modules.sesion.login.form.emailLabel')}
                    placeholder={t('modules.sesion.login.form.emailPlaceholder')}
                    aria-label={t('modules.sesion.login.form.emailLabel')}
                    name="email"
                    autoFocus={autoFocusFirst}
                    icon={<FaUserAlt />}
                    onAutofill={handleAutofill}
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
                    iconTabbable={false}
                    onAutofill={handleAutofill}
                  />
                </div>
                <div className="form-element w-full flex flex-col items-center">
                  <FormError message={formError} id="login-form-error" />
                  <Button
                    type="submit"
                    fullWidth
                    loading={isPending}
                    disabled={isRedirecting}
                    onPointerDown={handleSubmitPointerDown}
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
