import { zodResolver } from '@hookform/resolvers/zod';
import axios from 'axios';
import { useRef, useState } from 'react';
import { FormProvider, useForm, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import FormError from '@components/FormError';
import MfaCodeField from '@components/MfaCodeField';
import { notify } from '@components/notifications/notify';
import { getServerMessage, getStatus, isOutageStatus, resolveApiErrorMessage } from '@utils/apiError';
import { useMfaVerifyLogin } from '../hooks/useMfaVerifyLogin';
import {
  mfaLoginDefaultValues,
  recoveryLoginSchema,
  totpLoginSchema,
  type MfaLoginType,
} from './SchemaMfaLogin';

const KEY = 'modules.sesion.login.mfa';
const FORM_ID = 'mfa-login-form';
const RECOVERY_LENGTH = 16;
const TOTP_LENGTH = 6;

interface MfaLoginStepProps {
  /** The step-1 challenge token (in memory only). */
  mfaToken: string;
  /** Session established → run the leave-to-panel animation. */
  onVerified: () => void;
  /** The challenge expired/invalid (401) → revert to the credentials step with a message. */
  onExpired: () => void;
  /** User chose to go back to the credentials step. */
  onBack: () => void;
  /** Suspend interaction while the card is redirecting out. */
  disabled?: boolean;
}

/**
 * The in-card second login step: the login form-column is swapped for this (see `useAuthCard`
 * `swapFormColumn`), so it reuses the auth card's `.form-element` reveal. Accepts a 6-digit TOTP
 * (default, `autocomplete="one-time-code"`, auto-submits on a paste/autofill via `MfaCodeField`
 * `onComplete`) or a recovery code (toggle). Errors follow the app doctrine: a wrong code (422) is
 * inline, an expired challenge (401) reverts to credentials, a lockout (429) is inline, outages defer
 * to the overlay. `verify-login` is a `public` request carrying the `mfaToken` as a Bearer header, so
 * a 401 never triggers a token refresh (see `useMfaVerifyLogin`).
 */
const MfaLoginStep: React.FC<MfaLoginStepProps> = ({ mfaToken, onVerified, onExpired, onBack, disabled = false }) => {
  const { t } = useTranslation();
  const { verify, isPending } = useMfaVerifyLogin();

  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  // Mirrors `mode` for the resolver to read at validation time; updated in the toggle handler (never
  // during render) so the active schema follows the field without recreating the form.
  const modeRef = useRef<'totp' | 'recovery'>('totp');
  const isRecovery = mode === 'recovery';

  // Server submit error (wrong code / lockout), rendered inline above the button — not a toast.
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const submitLockRef = useRef(false);
  // Last code we auto-submitted, so a password manager re-filling the SAME (wrong) code doesn't loop.
  const lastAutoRef = useRef('');

  const methods = useForm<MfaLoginType>({
    // The active schema follows the mode; read lazily so a toggle doesn't need a new form.
    resolver: ((values, ctx, options) =>
      zodResolver(modeRef.current === 'recovery' ? recoveryLoginSchema : totpLoginSchema)(
        values,
        ctx,
        options,
      )) as Resolver<MfaLoginType>,
    defaultValues: mfaLoginDefaultValues,
    mode: 'onTouched',
  });
  const { handleSubmit, getValues, reset } = methods;

  const handleVerifyError = (error: unknown): void => {
    if (!axios.isAxiosError(error)) {
      setFormError(t('errors.generic'));
      return;
    }
    const status = getStatus(error);
    if (isOutageStatus(status)) return; // the app overlay owns backend-down states
    if (status === 401) {
      onExpired(); // the 5-min challenge died → back to credentials
      return;
    }
    if (status === 422) {
      setFormError(getServerMessage(error) ?? t(`${KEY}.errors.invalidCode`));
      return;
    }
    if (status === 429) {
      setFormError(getServerMessage(error) ?? t(`${KEY}.errors.locked`));
      return;
    }
    notify.error(resolveApiErrorMessage(error)); // 400 / 5xx / network
  };

  const onSubmit = (data: MfaLoginType): void => {
    if (isPending || submitLockRef.current) return;
    submitLockRef.current = true;
    lastAutoRef.current = data.code;
    setFormError(undefined);
    verify(
      { code: data.code, mfaToken },
      {
        onSettled: () => {
          submitLockRef.current = false;
        },
        onSuccess: (response) => {
          if (response.headers['authorization']) onVerified();
          else setFormError(t(`${KEY}.errors.invalidCode`));
        },
        onError: handleVerifyError,
      },
    );
  };

  // Auto-submit the one-tap flow: fired only when the field is bulk-filled (paste/autofill), and
  // deduped so the same code never re-fires (no loop / saturation). Manual typing uses the button.
  const autoSubmit = (): void => {
    if (getValues('code') === lastAutoRef.current) return;
    void handleSubmit(onSubmit)();
  };

  const switchMode = (next: 'totp' | 'recovery'): void => {
    modeRef.current = next;
    setMode(next);
    reset(mfaLoginDefaultValues);
    setFormError(undefined);
    lastAutoRef.current = '';
  };

  return (
    <div className="flex flex-col gap-7 justify-center items-center z-10 w-full max-w-md">
      <h2 className="form-element text-2xl sm:text-3xl font-bold text-black text-center select-none">
        {t(`${KEY}.title`)}
      </h2>
      <FormProvider {...methods}>
        <form
          id={FORM_ID}
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="w-full flex flex-col items-center gap-4 md:gap-5"
        >
          <p className="form-element text-sm text-charcoal/60 text-center max-w-xs">{t(`${KEY}.subtitle`)}</p>

          <div className="form-element w-full">
            {isRecovery ? (
              <MfaCodeField<MfaLoginType>
                key="recovery"
                name="code"
                id="mfa-login-code"
                mode="text"
                maxLength={RECOVERY_LENGTH}
                label={t(`${KEY}.recoveryLabel`)}
                disabled={disabled}
                autoFocus
              />
            ) : (
              <MfaCodeField<MfaLoginType>
                key="totp"
                name="code"
                id="mfa-login-code"
                mode="numeric"
                maxLength={TOTP_LENGTH}
                label={t(`${KEY}.codeLabel`)}
                disabled={disabled}
                onComplete={autoSubmit}
                autoFocus
              />
            )}
          </div>

          <div className="form-element w-full flex flex-col items-center">
            <FormError message={formError} id="mfa-login-error" />
            <Button type="submit" form={FORM_ID} fullWidth loading={isPending} disabled={disabled}>
              {t(`${KEY}.verifyButton`)}
            </Button>
          </div>

          <div className="form-element flex flex-col items-center gap-1 text-xs text-gray-500">
            <button
              type="button"
              onClick={() => switchMode(isRecovery ? 'totp' : 'recovery')}
              className="cursor-pointer rounded px-1 py-0.5 font-medium text-magenta outline-none transition-colors hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2"
            >
              {t(isRecovery ? `${KEY}.useAuthenticator` : `${KEY}.useRecoveryCode`)}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="cursor-pointer rounded px-1 py-0.5 outline-none transition-colors hover:text-charcoal hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2"
            >
              {t(`${KEY}.back`)}
            </button>
          </div>
        </form>
      </FormProvider>
    </div>
  );
};

export default MfaLoginStep;
