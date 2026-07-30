import { useRef } from 'react';
import { Controller, useFormContext, type FieldValues, type Path } from 'react-hook-form';
import AnimatedMessage from '@components/AnimatedMessage';
import useDesktopAutoFocus from '@hooks/useDesktopAutoFocus';

/** `numeric` = 6-digit TOTP (digits only, OTP autofill); `text` = alphanumeric recovery code. */
export type MfaCodeMode = 'numeric' | 'text';

interface MfaCodeFieldProps<T extends FieldValues> {
  /** RHF field name (the code). */
  name: Path<T>;
  /** Visible label above the field. */
  label: string;
  /** Accessible id, also used to wire the error message via `aria-describedby`. */
  id?: string;
  /** How many characters to allow (6 for a TOTP; 16 for a recovery code). */
  maxLength?: number;
  /** Move focus here when the step mounts. */
  autoFocus?: boolean;
  /** Suspend input while a request is in flight. */
  disabled?: boolean;
  /**
   * `numeric` (default): digits-only, `one-time-code` autofill, tabular monospace slot — a TOTP.
   * `text`: alphanumeric (upper-cased, separators stripped), autofill off — a recovery code.
   */
  mode?: MfaCodeMode;
  /**
   * Fired when the field is filled to `maxLength` by a **bulk insert** — a paste or a password-manager
   * autofill (a multi-character jump), NOT by manual typing. Lets the login step auto-submit the
   * one-tap flow while a hand-typed code still waits for the button. Numeric mode only.
   */
  onComplete?: () => void;
}

/**
 * The one-time-code / recovery-code entry field: a large, centered, wide-tracked input that reads as
 * a code slot rather than a normal text box. In `numeric` mode it offers the OS/password-manager the
 * digits (`autocomplete="one-time-code"`, numeric keyboard) and reports a bulk fill via `onComplete`
 * (for GitHub-style auto-submit); in `text` mode it accepts a recovery code. A gentle inline error
 * (`AnimatedMessage`, `role="alert"`) is shown once the user has left the field or tried to submit.
 * Generic over the form shape and meant to live inside a `FormProvider`.
 */
function MfaCodeField<T extends FieldValues>({
  name,
  label,
  id = 'mfa-code',
  maxLength = 6,
  autoFocus = false,
  disabled = false,
  mode = 'numeric',
  onComplete,
}: MfaCodeFieldProps<T>) {
  const { control, formState } = useFormContext<T>();
  // `autoFocus` is the caller's INTENT ("this is the field to start on"); whether it actually
  // happens is the device's call. On touch, focusing here would pop the keyboard the moment the
  // MFA step swaps in — mid-animation, over the card. The same rule the dialogs and the auth pages
  // use, so a caller can never opt out of it by accident.
  const canAutoFocus = useDesktopAutoFocus();
  const focusOnMount = autoFocus && canAutoFocus;
  // Read at the top so the component subscribes to `isSubmitted` (reveal errors after a submit
  // attempt even on a field the user never blurred) — matching CustomInputForm.
  const { isSubmitted } = formState;
  const messageId = `${id}-message`;
  const numeric = mode === 'numeric';
  // Previous length, to tell a bulk insert (paste/autofill: jump > 1) from typing (one char at a time).
  const prevLenRef = useRef(0);

  // Keep the value clean for the mode: digits for a TOTP, upper-cased alphanumerics for a recovery
  // code (so a pasted "abcd-2345-…" lands as "ABCD2345…").
  const sanitize = (raw: string): string =>
    numeric ? raw.replace(/\D/g, '') : raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error, isTouched } }) => {
        const showError = Boolean(error) && (isTouched || isSubmitted);
        const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
          const next = sanitize(event.target.value).slice(0, maxLength);
          const prevLen = prevLenRef.current;
          prevLenRef.current = next.length;
          field.onChange(next);
          // A bulk insert that completes the code (paste / autofill) — not the last keystroke of
          // manual typing — triggers the one-tap auto-submit. Numeric (TOTP) only.
          if (numeric && onComplete && next.length === maxLength && next.length - prevLen > 1) {
            onComplete();
          }
        };
        return (
          <div className="flex flex-col">
            <label htmlFor={id} className="mb-2 text-sm font-medium text-charcoal/70">
              {label}
            </label>
            <input
              {...field}
              id={id}
              type="text"
              inputMode={numeric ? 'numeric' : 'text'}
              autoComplete={numeric ? 'one-time-code' : 'off'}
              autoCapitalize={numeric ? undefined : 'characters'}
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={maxLength}
              disabled={disabled}
              autoFocus={focusOnMount}
              data-modal-autofocus={focusOnMount || undefined}
              aria-required
              aria-invalid={showError || undefined}
              aria-describedby={showError ? messageId : undefined}
              onChange={handleChange}
              className={`h-14 w-full rounded-control border bg-white text-center font-semibold text-charcoal transition-colors placeholder:text-charcoal/25 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                numeric ? 'text-2xl tracking-[0.4em] placeholder:tracking-normal' : 'text-lg tracking-[0.15em]'
              } ${
                showError
                  ? 'border-red-500 focus:border-red-500'
                  : 'border-charcoal/15 focus:border-magenta'
              }`}
              placeholder={numeric ? '••••••' : 'XXXXXXXXXXXXXXXX'}
            />
            <AnimatedMessage id={messageId} errorMessage={showError ? error?.message : undefined} />
          </div>
        );
      }}
    />
  );
}

export default MfaCodeField;
