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
 * chosen) or the field is focused. The underline is EXPLICIT (`border-black`) — the value text is
 * `text-transparent` while empty, so a currentColor border would vanish with it.
 *
 * The chevron rotates while the native dropdown is (heuristically) open: the platform gives no
 * open/close event, so pointer/keyboard opens flip it and `change`/`blur`/`Escape` settle it back —
 * the same smooth cue as the header pill's menu. NOTE the transition targets the `rotate` property:
 * Tailwind v4 emits `rotate-*` as the independent `rotate:` CSS property, NOT `transform` (the
 * same gotcha as the auth card) — `transition-transform` would snap.
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
      onPointerDown,
      onKeyDown,
      onBlur,
      value,
      ...props
    }: CustomSelectProps,
    ref,
  ) => {
    const { t } = useTranslation();
    const [isFilledOnChange, setIsFilledOnChange] = useState(
      value !== undefined && value !== '',
    );
    // Best-effort "the native dropdown is open" flag driving the chevron rotation.
    const [isOpen, setIsOpen] = useState(false);

    const localChange = useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => {
        setIsFilledOnChange(event.target.value !== '');
        setIsOpen(false); // picking an option closes the dropdown
        onChange?.(event);
      },
      [onChange],
    );

    const localPointerDown = useCallback(
      (event: React.PointerEvent<HTMLSelectElement>) => {
        // A click either opens the dropdown or (while open) closes it — toggle.
        if (!disabled) setIsOpen((open) => !open);
        onPointerDown?.(event);
      },
      [disabled, onPointerDown],
    );

    const localKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLSelectElement>) => {
        if (event.key === 'Escape') setIsOpen(false);
        // The platform open gestures: Enter/Space, or (Alt+)ArrowDown/ArrowUp.
        else if (
          event.key === 'Enter' ||
          event.key === ' ' ||
          event.key === 'ArrowDown' ||
          event.key === 'ArrowUp'
        ) {
          setIsOpen(true);
        }
        onKeyDown?.(event);
      },
      [onKeyDown],
    );

    const localBlur = useCallback(
      (event: React.FocusEvent<HTMLSelectElement>) => {
        setIsOpen(false); // clicking/tabbing away always settles the chevron
        onBlur?.(event);
      },
      [onBlur],
    );

    // Controlled (the RHF wrapper always passes `value`) → the live value decides, so a
    // programmatic reset drops the label; the onChange state is only the uncontrolled fallback.
    const isFilled = value !== undefined ? value !== '' : isFilledOnChange;

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
          onPointerDown={localPointerDown}
          onKeyDown={localKeyDown}
          onBlur={localBlur}
          className={twMerge(
            `peer w-full appearance-none py-2 pl-2 pr-8 bg-transparent text-md focus:outline-none transition-all duration-300 border-b cursor-pointer
            disabled:text-gray-disabled disabled:cursor-not-allowed
            ${error ? 'border-red-600 text-red-600' : 'text-black border-black disabled:border-gray-disabled'}
            ${isFilled ? '' : 'text-transparent focus:text-gray-disabled'}`,
            className,
          )}
        >
          {placeholderOption !== undefined && (
            <option value="" className="text-gray-disabled">
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
          className={`pointer-events-none absolute right-2 size-4 transition-[rotate,color] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none
            ${isOpen ? 'rotate-180' : 'rotate-0'}
            ${error ? 'text-red-600' : 'text-gray-disabled peer-focus:text-black'}`}
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
