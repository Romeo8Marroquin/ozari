import { forwardRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { twMerge } from 'tailwind-merge';

interface CustomTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  focusColor?: string;
  error?: boolean;
  isRequired?: boolean;
  optionalLabel?: boolean;
}

const peerFocusTextClass: Record<string, string> = {
  midnight: 'peer-focus:text-midnight',
};

const bgClass: Record<string, string> = {
  midnight: 'bg-midnight',
};

/**
 * The multi-line sibling of {@link CustomInput}: same underline field, floating label, animated
 * focus rule and error state — minus the icon/password machinery a textarea never needs. Vertical
 * resize only (never horizontal, which would break the underline).
 */
const CustomTextarea = forwardRef<HTMLTextAreaElement, CustomTextareaProps>(
  (
    {
      id,
      label,
      className,
      focusColor = 'midnight',
      error,
      disabled,
      isRequired = false,
      optionalLabel = false,
      rows = 3,
      onChange,
      ...props
    }: CustomTextareaProps,
    ref,
  ) => {
    const { t } = useTranslation();
    const [isFilledOnChange, setIsFilledOnChange] = useState(Boolean(props.value));

    const localChange = useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setIsFilledOnChange(Boolean(event.target.value));
        onChange?.(event);
      },
      [onChange],
    );

    const isFilled = isFilledOnChange || Boolean(props.value);

    return (
      <div className="relative flex items-start justify-center w-full">
        <textarea
          ref={ref}
          {...props}
          id={id}
          rows={rows}
          disabled={disabled}
          aria-invalid={error || undefined}
          aria-required={isRequired || undefined}
          onChange={localChange}
          className={twMerge(
            `peer w-full resize-y py-2 pl-2 pr-4 bg-transparent placeholder:opacity-0 placeholder:transition-color placeholder:duration-300 focus:placeholder:opacity-100 text-md placeholder-gray focus:outline-none transition-all duration-300 border-b
            disabled:text-gray-disabled disabled:placeholder-gray-disabled
            ${error ? 'border-red-600 text-red-600' : 'text-black border-gray'}`,
            className,
          )}
        />
        <label
          htmlFor={id}
          className={`absolute left-2 top-2 text-md pointer-events-none transition-all duration-300 origin-left peer-focus:-translate-y-6 peer-focus:scale-75 peer-disabled:text-gray-disabled
          ${error ? 'text-red-600' : `text-black ${peerFocusTextClass[focusColor]}`}
          ${isFilled ? '-translate-y-6 scale-75' : ''}
        `}
        >
          <span>{label}</span>
          {!optionalLabel && isRequired && (
            <>
              <span aria-hidden className="ml-[0.1rem]">
                {t('components.customInput.requiredField')}
              </span>
              <span className="sr-only"> ({t('components.customInput.requiredFieldLabel')})</span>
            </>
          )}
          {optionalLabel && !isRequired && (
            <span className="ml-[0.1rem]">{t('components.customInput.optionalField')}</span>
          )}
        </label>
        <hr
          className={`absolute border-none bottom-0 left-0 max-w-full w-full h-0.5 origin-left scale-x-0 transition-transform duration-300 peer-focus:scale-x-100
            ${error ? 'bg-red-600' : bgClass[focusColor]}
          `}
        />
      </div>
    );
  },
);

export default CustomTextarea;
