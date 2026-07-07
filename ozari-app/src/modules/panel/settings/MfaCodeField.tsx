import { Controller, useFormContext, type FieldValues, type Path } from 'react-hook-form';
import AnimatedMessage from '@components/AnimatedMessage';

interface MfaCodeFieldProps<T extends FieldValues> {
  /** RHF field name (the code). */
  name: Path<T>;
  /** Visible label above the field. */
  label: string;
  /** Accessible id, also used to wire the error message via `aria-describedby`. */
  id?: string;
  /** How many characters to allow (6 for a TOTP; a login screen may raise it for recovery codes). */
  maxLength?: number;
  /** Move focus here when the step mounts (used by the enable wizard's verify step). */
  autoFocus?: boolean;
  /** Suspend input while the confirm request is in flight. */
  disabled?: boolean;
}

/**
 * The one-time-code entry field: a large, centered, wide-tracked input that reads as a code slot
 * rather than a normal text box. Numeric soft keyboard on mobile, `one-time-code` autocomplete so
 * the OS can offer the digits, and a gentle inline error (same `AnimatedMessage` language as the
 * auth forms) shown only once the user has left the field or tried to submit. Generic over the form
 * shape so the future two-step login can reuse it. Meant to live inside a `FormProvider`.
 */
function MfaCodeField<T extends FieldValues>({
  name,
  label,
  id = 'mfa-code',
  maxLength = 6,
  autoFocus = false,
  disabled = false,
}: MfaCodeFieldProps<T>) {
  const { control, formState } = useFormContext<T>();
  // Read at the top so the component subscribes to `isSubmitted` (reveal errors after a submit
  // attempt even on a field the user never blurred) — matching CustomInputForm.
  const { isSubmitted } = formState;
  const messageId = `${id}-message`;

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error, isTouched } }) => {
        const showError = Boolean(error) && (isTouched || isSubmitted);
        return (
          <div className="flex flex-col">
            <label htmlFor={id} className="mb-2 text-sm font-medium text-charcoal/70">
              {label}
            </label>
            <input
              {...field}
              id={id}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={maxLength}
              disabled={disabled}
              autoFocus={autoFocus}
              data-modal-autofocus={autoFocus || undefined}
              aria-invalid={showError || undefined}
              aria-describedby={showError ? messageId : undefined}
              // Keep the value digits-only as the user types — paste of a "123 456" style code still
              // lands clean, and the field mirrors what the backend will accept.
              onChange={(event) => field.onChange(event.target.value.replace(/\D/g, ''))}
              className={`h-14 w-full rounded-control border bg-white text-center text-2xl font-semibold tracking-[0.4em] text-charcoal transition-colors placeholder:tracking-normal placeholder:text-charcoal/25 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                showError
                  ? 'border-red-500 focus:border-red-500'
                  : 'border-charcoal/15 focus:border-magenta'
              }`}
              placeholder="••••••"
            />
            <AnimatedMessage id={messageId} errorMessage={showError ? error?.message : undefined} />
          </div>
        );
      }}
    />
  );
}

export default MfaCodeField;
