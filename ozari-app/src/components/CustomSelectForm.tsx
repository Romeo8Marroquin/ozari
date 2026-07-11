import React, { useCallback, useRef, useState } from 'react';
import { Controller, useFormContext, type FieldValues, type Path } from 'react-hook-form';
import CustomSelect, { type SelectOption } from './CustomSelect';
import useRequiredPatterns from '../contexts/RequiredFieldsContext';
import AnimatedMessage from './AnimatedMessage';

interface CustomSelectFormProps<T extends FieldValues>
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  name: Path<T>;
  label: string;
  options: SelectOption[];
  /** Renders an initial empty option the user must move away from (e.g. "choose a category"). */
  placeholderOption?: string;
  focusColor?: string;
  instructions?: string;
  optionalLabel?: boolean;
  /** Other field names to re-validate whenever THIS field changes (cross-field rules). */
  deps?: Path<T>[];
}

/**
 * RHF wrapper around {@link CustomSelect}, mirroring {@link CustomInputForm}: required-marker via
 * the form's required patterns, per-field user-touched gating, inline `AnimatedMessage` errors.
 * The form value is a **number | undefined** (an empty selection maps to `undefined`, a picked
 * option to its numeric id) — the DOM `<select>` speaks strings, the translation lives here.
 */
const CustomSelectForm = function <T extends FieldValues>({
  name,
  options,
  instructions = '',
  focusColor,
  deps,
  ...props
}: CustomSelectFormProps<T>) {
  const { control, trigger, formState } = useFormContext<T>();
  const requiredPatterns = useRequiredPatterns();
  const isRequired = requiredPatterns.some((pattern) => pattern.test(name));
  const { isSubmitted } = formState;

  // Same real-interaction "touched" convention as CustomInputForm: only a genuine user engagement
  // followed by leaving the field reveals an error (programmatic focus shuffles never do).
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
        const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
          const raw = event.target.value;
          // `null` (not `undefined`) is the empty-selection sentinel: RHF's setValue/reset ignore
          // `undefined` (they fall back to defaults), and JSON drafts drop it — null survives both.
          field.onChange(raw === '' ? null : Number(raw));
          // A selection is a completed interaction — commit touched immediately (unlike a text
          // input, there is no "still typing" state to protect).
          if (engagedRef.current) setUserTouched(true);
          if (deps?.length) void trigger(deps);
        };
        const handleBlur = () => {
          field.onBlur();
          if (engagedRef.current) setUserTouched(true);
        };
        const messageId = `${String(name)}-message`;
        const showError = Boolean(error) && (userTouched || isSubmitted);
        const describedBy = showError || instructions ? messageId : undefined;
        return (
          <div className="w-full flex flex-col">
            <CustomSelect
              {...props}
              options={options}
              name={field.name}
              ref={field.ref}
              value={field.value === undefined || field.value === null ? '' : String(field.value)}
              onChange={handleChange}
              onBlur={handleBlur}
              onPointerDown={markEngaged}
              onKeyDown={markEngaged}
              focusColor={focusColor}
              error={showError}
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

export default CustomSelectForm;
