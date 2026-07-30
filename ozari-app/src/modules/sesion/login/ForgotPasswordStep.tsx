import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useRef, useState } from 'react';
import { HiOutlineMail } from 'react-icons/hi';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import CustomInputForm from '@components/CustomInputForm';
import FormError from '@components/FormError';
import { notify } from '@components/notifications/notify';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import useDesktopAutoFocus from '@hooks/useDesktopAutoFocus';
import { toFormError } from '@utils/apiError';
import { useForgotPassword } from '../hooks/useForgotPassword';
import {
  forgotPasswordDefaultValues,
  forgotPasswordSchema,
  forgotRequiredPatterns,
  type ForgotPasswordType,
} from './SchemaForgotPassword';

const KEY = 'modules.sesion.forgot';
const FORM_ID = 'forgot-password-form';

interface ForgotPasswordStepProps {
  /** Return to the credentials step (used by the "back" link AND after a successful request). */
  onBack: () => void;
  /** Suspend interaction while the card is animating out. */
  disabled?: boolean;
}

/**
 * The in-card "request a reset" step: the login form-column is swapped for this (see `useAuthCard`
 * `swapFormColumn`), reusing the auth card's `.form-element` reveal — the same motion as the MFA
 * step. Because the backend response is deliberately identical whether or not the email exists, a
 * success just fires a generic confirmation toast and sweeps back to the credentials step (mirroring
 * the register flow); errors follow the app doctrine (validation/429 inline, outages to the overlay).
 */
const ForgotPasswordStep: React.FC<ForgotPasswordStepProps> = ({ onBack, disabled = false }) => {
  const { t } = useTranslation();
  // Mouse/trackpad only: on touch, focusing the email as this step sweeps in would pop the keyboard
  // over the card mid-animation — the same rule the login form it replaces already follows.
  const autoFocusFirst = useDesktopAutoFocus();
  const { requestReset, isPending } = useForgotPassword();
  // Server submit error, rendered inline above the button — not a toast.
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const submitLockRef = useRef(false);

  const methods = useForm<ForgotPasswordType>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: forgotPasswordDefaultValues,
    mode: 'onTouched',
  });
  const { handleSubmit } = methods;

  const onSubmit = (data: ForgotPasswordType): void => {
    if (isPending || submitLockRef.current) return;
    submitLockRef.current = true;
    setFormError(undefined);
    requestReset(
      { email: data.email },
      {
        onSettled: () => {
          submitLockRef.current = false;
        },
        onSuccess: () => {
          // Generic confirmation (same regardless of whether the email exists) + sweep back to login,
          // with the toast persisting through the transition.
          notify.success(t(`${KEY}.api.successToast`), { title: t(`${KEY}.api.successTitle`) });
          onBack();
        },
        onError: (error) => {
          const { inline, toast } = toFormError(error, t(`${KEY}.api.requestError`));
          if (inline) setFormError(inline);
          if (toast) notify.error(toast);
        },
      },
    );
  };

  const requiredPatternsContextValue = useMemo(
    () => ({ requiredPatterns: forgotRequiredPatterns }),
    [],
  );

  return (
    <div className="flex flex-col gap-7 justify-center items-center z-10 w-full max-w-md">
      <h2 className="form-element text-2xl sm:text-3xl font-bold text-black text-center select-none">
        {t(`${KEY}.title`)}
      </h2>
      <RequiredPatternsContext.Provider value={requiredPatternsContextValue}>
        <FormProvider {...methods}>
          <form
            id={FORM_ID}
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
            className="w-full flex flex-col items-center gap-4 md:gap-5"
          >
            <p className="form-element text-sm text-charcoal/60 text-center max-w-xs">
              {t(`${KEY}.subtitle`)}
            </p>

            <div className="form-element w-full">
              <CustomInputForm<ForgotPasswordType>
                id="forgot-email-input"
                data-testid="forgot-email-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="text-lg"
                label={t(`${KEY}.emailLabel`)}
                placeholder={t(`${KEY}.emailPlaceholder`)}
                aria-label={t(`${KEY}.emailLabel`)}
                name="email"
                icon={<HiOutlineMail />}
                disabled={disabled}
                autoFocus={autoFocusFirst}
              />
            </div>

            <div className="form-element w-full flex flex-col items-center">
              <FormError message={formError} id="forgot-form-error" />
              <Button type="submit" form={FORM_ID} fullWidth loading={isPending} disabled={disabled}>
                {t(`${KEY}.submitButton`)}
              </Button>
            </div>

            <button
              type="button"
              onClick={onBack}
              disabled={disabled}
              className="form-element cursor-pointer rounded px-1 py-0.5 text-xs text-gray-500 outline-none transition-colors hover:text-charcoal hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2"
            >
              {t(`${KEY}.back`)}
            </button>
          </form>
        </FormProvider>
      </RequiredPatternsContext.Provider>
    </div>
  );
};

export default ForgotPasswordStep;
