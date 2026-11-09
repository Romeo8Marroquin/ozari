import { useCallback, useRef, useState } from 'react';
import { Controller, useFormContext, type FieldValues, type Path } from 'react-hook-form';
import useRequiredPatterns from '../contexts/RequiredFieldsContext';
import AnimatedMessage from './AnimatedMessage';
import ImageSelect, { type ImageSelectOption } from './ImageSelect';

interface ImageSelectFormProps<T extends FieldValues> {
  id: string;
  name: Path<T>;
  label: string;
  options: ImageSelectOption[];
  placeholderOption?: string;
  instructions?: string;
  optionalLabel?: boolean;
}

/**
 * RHF wrapper around {@link ImageSelect} — {@link CustomSelectForm}'s twin, with the same contract:
 * the required marker from the form's patterns, `null` as the empty-selection sentinel (never
 * `undefined`, which `setValue`/`reset` ignore and JSON drafts drop), and an error revealed only after
 * a GENUINE engagement followed by leaving the field, or after a submit attempt.
 */
const ImageSelectForm = function <T extends FieldValues>({
  id,
  name,
  options,
  instructions = '',
  ...props
}: ImageSelectFormProps<T>) {
  const { control, formState } = useFormContext<T>();
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
        const messageId = `${String(name)}-message`;
        const showError = Boolean(error) && (userTouched || isSubmitted);
        return (
          <div className="flex w-full min-w-0 flex-col">
            <ImageSelect
              {...props}
              id={id}
              ref={field.ref}
              options={options}
              value={(field.value as number | null | undefined) ?? null}
              onChange={(next) => {
                field.onChange(next);
                // A pick is a completed interaction — touched at once (nothing is "still typing").
                if (engagedRef.current) setUserTouched(true);
              }}
              onBlur={() => {
                field.onBlur();
                if (engagedRef.current) setUserTouched(true);
              }}
              onEngage={markEngaged}
              error={showError}
              isRequired={isRequired}
              aria-describedby={showError || instructions ? messageId : undefined}
            />
            <AnimatedMessage
              id={messageId}
              errorMessage={showError ? error?.message : undefined}
              instructions={instructions}
            />
          </div>
        );
      }}
    />
  );
};

export default ImageSelectForm;
