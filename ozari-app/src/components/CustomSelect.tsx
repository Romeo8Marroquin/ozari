import { forwardRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiChevronDown } from 'react-icons/hi2';
import { twMerge } from 'tailwind-merge';

export interface SelectOption {
  value: number;
  label: string;
}

interface CustomSelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string;
  options: SelectOption[];
  /** Renders an initial empty option the user must move away from (e.g. "choose a category"). */
  placeholderOption?: string;
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
 * The select sibling of {@link CustomInput} — a STYLED NATIVE `<select>` (appearance-none + a
 * chevron) so keyboard, mobile pickers, and screen-reader semantics come from the platform for
 * free, wearing the same visual language: underline field, floating label, animated focus rule,
 * error state. The label floats whenever a value is selected (a select always "has" a value once
 * chosen) or the field is focused.
 */
const CustomSelect = forwardRef<HTMLSelectElement, CustomSelectProps>(
  (
    {
      id,
      label,
      options,
      placeholderOption,
      className,
      focusColor = 'midnight',
      error,
      disabled,
      isRequired = false,
      optionalLabel = false,
      onChange,
      value,
      ...props
    }: CustomSelectProps,
    ref,
  ) => {
    const { t } = useTranslation();
    const [isFilledOnChange, setIsFilledOnChange] = useState(
      value !== undefined && value !== '',
    );

    const localChange = useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => {
        setIsFilledOnChange(event.target.value !== '');
        onChange?.(event);
      },
      [onChange],
    );

    const isFilled = isFilledOnChange || (value !== undefined && value !== '');

    return (
      <div className="relative flex items-center justify-center w-full">
        <select
          ref={ref}
          {...props}
          id={id}
          value={value}
          disabled={disabled}
          aria-invalid={error || undefined}
          aria-required={isRequired || undefined}
          onChange={localChange}
          className={twMerge(
            `peer w-full appearance-none py-2 pl-2 pr-8 bg-transparent text-md focus:outline-none transition-all duration-300 border-b cursor-pointer
            disabled:text-gray-disabled disabled:cursor-not-allowed
            ${error ? 'border-red-600 text-red-600' : 'text-black border-gray'}
            ${isFilled ? '' : 'text-transparent focus:text-gray'}`,
            className,
          )}
        >
          {placeholderOption !== undefined && (
            <option value="" className="text-gray">
              {placeholderOption}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} className="text-black">
              {option.label}
            </option>
          ))}
        </select>
        <label
          htmlFor={id}
          className={`absolute left-2 text-md pointer-events-none transition-all duration-300 origin-left peer-focus:-translate-y-6 peer-focus:scale-75 peer-disabled:text-gray-disabled
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
        <HiChevronDown
          aria-hidden
          className={`pointer-events-none absolute right-2 size-4 transition-colors duration-300
            ${error ? 'text-red-600' : 'text-gray peer-focus:text-black'}`}
        />
        <hr
          className={`absolute border-none bottom-0 left-0 max-w-full w-full h-0.5 origin-left scale-x-0 transition-transform duration-300 peer-focus:scale-x-100
            ${error ? 'bg-red-600' : bgClass[focusColor]}
          `}
        />
      </div>
    );
  },
);

export default CustomSelect;
