import React, { useCallback, useRef, useState } from 'react';
import { Controller, useFormContext, type FieldValues, type Path } from 'react-hook-form';
import CustomTextarea from './CustomTextarea';
import useRequiredPatterns from '../contexts/RequiredFieldsContext';
import AnimatedMessage from './AnimatedMessage';

interface CustomTextareaFormProps<T extends FieldValues>
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  name: Path<T>;
  label: string;
  focusColor?: string;
  instructions?: string;
  optionalLabel?: boolean;
  /** Other field names to re-validate whenever THIS field changes (cross-field rules). */
  deps?: Path<T>[];
}

/**
 * RHF wrapper around {@link CustomTextarea}, mirroring {@link CustomInputForm}: required-marker via
 * the form's required patterns, per-field real-interaction "touched" gating (errors only show once
 * the USER engaged and left the field, or after a submit attempt), inline `AnimatedMessage`.
 */
const CustomTextareaForm = function <T extends FieldValues>({
  name,
  instructions = '',
  focusColor,
  deps,
  ...props
}: CustomTextareaFormProps<T>) {
  const { control, trigger, formState } = useFormContext<T>();
  const requiredPatterns = useRequiredPatterns();
  const isRequired = requiredPatterns.some((pattern) => pattern.test(name));
  const { isSubmitted } = formState;

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
        const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          field.onChange(event);
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
            <CustomTextarea
              {...props}
              {...field}
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

export default CustomTextareaForm;
