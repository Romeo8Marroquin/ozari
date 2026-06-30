import React, { useCallback, useRef, useState } from 'react';
import { Controller, useFormContext, type FieldValues, type Path } from 'react-hook-form';
import CustomInput from './CustomInput';
import useRequiredPatterns from '../contexts/RequiredFieldsContext';
import AnimatedMessage from './AnimatedMessage';

interface CustomInputFormProps<T extends FieldValues>
  extends React.InputHTMLAttributes<HTMLInputElement> {
  name: Path<T>;
  label: string;
  enableIconPointerEvents?: boolean;
  focusColor?: string;
  icon?: React.ReactNode;
  instructions?: string;
  optionalLabel?: boolean;
  ref?: React.RefObject<HTMLInputElement | null>;
  onIconClick?: () => void;
  /** Forwarded to {@link CustomInput}: keep the icon button in the tab order (default) or
   *  skip it (e.g. the password show/hide toggle) while keeping click + label. */
  iconTabbable?: boolean;
  /**
   * Other field names to re-validate whenever THIS field changes — for cross-field rules
   * where a dependent field's validity is derived from this one (e.g. a `password` field
   * whose `confirmPassword` depends on it). RHF only re-validates the changed field by
   * default, so the dependents are triggered explicitly here.
   */
  deps?: Path<T>[];
  /** Forwarded to {@link CustomInput}: called when this field is autofilled. */
  onAutofill?: () => void;
}

const CustomInputForm = function <T extends FieldValues>({
  name,
  instructions = '',
  focusColor,
  deps,
  ref,
  ...props
}: CustomInputFormProps<T>) {
  const { control, trigger, formState } = useFormContext<T>();
  const requiredPatterns = useRequiredPatterns();
  const isRequired = requiredPatterns.some((pattern) => pattern.test(name));
  // After a submit attempt, reveal errors on every field even if the user never blurred them
  // (e.g. they tapped submit on an empty form, or the submit button isn't validity-gated).
  const { isSubmitted } = formState;

  // Our own per-field "touched" state, set ONLY by a real user interaction with THIS input.
  // We deliberately do NOT use RHF's `isTouched`: it's set by every blur, including the
  // programmatic focus/blur a password manager (or our desktop autofocus) performs — which is
  // exactly what made a "required" error flash before, and made it re-appear the instant the
  // user merely FOCUSED an already-(programmatically-)touched field. `engagedRef` flips only
  // on a `pointerdown`/`keydown` ON the input (click, tap, typing, or Tabbing out while
  // focused); programmatic `.focus()`/`.blur()` fire neither, so they're skipped as if the
  // field was never touched. Touched is then committed on the first blur that follows a real
  // engagement — so the error appears when the USER leaves the field, never on enter.
  const [userTouched, setUserTouched] = useState(false);
  const engagedRef = useRef(false);
  const markEngaged = useCallback(() => {
    engagedRef.current = true;
  }, []);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const combinedRef = (element: HTMLInputElement | null) => {
          field.ref(element);
          if (typeof ref === 'object' && ref !== null) ref.current = element;
        };
        const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
          field.onChange(event);
          // Re-validate any fields that depend on this one so they update when the
          // independent field changes (RHF only re-validates the changed field otherwise).
          if (deps?.length) void trigger(deps);
        };
        const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
          // Capture an autofilled value the controlled input may have missed. A mobile password
          // manager (or iOS AutoFill) can populate the field WITHOUT firing React's onChange,
          // leaving RHF empty — and then any re-render (like the setUserTouched below) would
          // reset the DOM back to that empty value, losing it entirely. Syncing it here from
          // the blur event keeps RHF and the DOM in agreement so the value survives.
          if (event.target.value !== field.value) field.onChange(event.target.value);
          field.onBlur(); // keep RHF's own state/validation in sync
          // Only a blur the user caused (the field was genuinely engaged first) commits
          // touched — a password manager shuffling focus can't.
          if (engagedRef.current) setUserTouched(true);
        };
        const messageId = `${String(name)}-message`;
        // Show the error only once the user has truly touched THIS field (engaged + left it).
        // This also keeps validation per-field: the Zod resolver re-validates the WHOLE form on
        // every keystroke, so without per-field gating, typing in one field would light up
        // every other untouched one.
        const showError = Boolean(error) && (userTouched || isSubmitted);
        const describedBy = showError || instructions ? messageId : undefined;
        return (
          <div className="w-full flex flex-col">
            <CustomInput
              {...props}
              {...field}
              onChange={handleChange}
              onBlur={handleBlur}
              onPointerDown={markEngaged}
              onKeyDown={markEngaged}
              focusColor={focusColor}
              error={showError}
              ref={combinedRef}
              isRequired={isRequired}
              aria-describedby={describedBy}
            />
            <AnimatedMessage
              id={messageId}
              errorMessage={showError ? error?.message : undefined}
              focusColor={focusColor}
              instructions={instructions}
            />
          </div>
        );
      }}
    />
  );
};

export default CustomInputForm;
