import gsap from 'gsap';
import { forwardRef, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiEye, HiEyeSlash } from 'react-icons/hi2';
import { twMerge } from 'tailwind-merge';
import useDetectAutofill from '../hooks/useDetectAutofill';

interface CustomInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  enableIconPointerEvents?: boolean;
  focusColor?: string;
  icon?: React.ReactNode;
  error?: boolean;
  isRequired?: boolean;
  optionalLabel?: boolean;
  onIconClick?: () => void;
  /**
   * Whether the interactive icon button (e.g. an action button) participates in the tab
   * order. Defaults to `true` — keep it for real actions (a search button must be
   * keyboard-operable). Set `false` for a pure pointer/touch convenience like the
   * password show/hide toggle, which only changes how an existing value is displayed:
   * it stays clickable + labelled, but no longer interrupts the email→password→submit
   * keyboard flow. (`-1` keeps it out of Tab, not out of the accessibility tree.)
   */
  iconTabbable?: boolean;
  /** Called when this input is autofilled by the browser / a password manager. */
  onAutofill?: () => void;
}

const bgClass: Record<string, string> = {
  midnight: 'bg-midnight',
};

const peerFocusTextClass: Record<string, string> = {
  midnight: 'peer-focus:text-midnight',
};

const focusTextClass: Record<string, string> = {
  midnight: 'focus:text-midnight',
};

const CustomInput = forwardRef<HTMLInputElement, CustomInputProps>(
  (
    {
      id,
      icon,
      className,
      enableIconPointerEvents: enablePointerEvents,
      focusColor = 'midnight',
      label,
      error,
      type,
      disabled,
      isRequired = false,
      optionalLabel = false,
      onIconClick,
      iconTabbable = true,
      onAutofill,
      onChange,
      ...props
    }: CustomInputProps,
    ref,
  ) => {
    const { t } = useTranslation();
    const [isFilledOnChange, setIsFilledOnChange] = useState(Boolean(props.value));
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const iconButtonRef = useRef<HTMLDivElement>(null);
    const { containerRef } = useDetectAutofill(onAutofill);

    const localOnIconClick = useCallback(
      (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) return;
        if (type === 'password') {
          e.preventDefault();
          const tl = gsap.timeline({ defaults: { duration: 0.2, ease: 'power1.inOut' } });
          tl.to(iconButtonRef.current, {
            scaleY: 0,
          })
            .add(() => setIsPasswordVisible((prev) => !prev))
            .to(iconButtonRef.current, {
              scaleY: 1,
            });
          return;
        }
        onIconClick?.();
      },
      [onIconClick, type, disabled],
    );

    const localChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setIsFilledOnChange(Boolean(e.target.value));
        onChange?.(e);
      },
      [onChange],
    );
    const passwordIcon = isPasswordVisible ? <HiEyeSlash /> : <HiEye />;
    const iconToShow = type === 'password' ? passwordIcon : icon;
    // CONTROLLED (every RHF wrapper passes `value`) → the live value is the ONLY truth, so a
    // programmatic reset/setValue drops the floating label correctly. The onChange-tracked state is
    // just the uncontrolled fallback — as a `||` it went stale after `reset()` (the label stuck up).
    const isFilled = props.value !== undefined ? Boolean(props.value) : isFilledOnChange;
    const isInteractive = type === 'password' || enablePointerEvents || Boolean(onIconClick);

    return (
      <div className="relative flex items-center justify-center w-full" ref={containerRef}>
        <input
          ref={ref}
          {...props}
          id={id}
          disabled={disabled}
          aria-invalid={error || undefined}
          aria-required={isRequired || undefined}
          onChange={localChange}
          type={isPasswordVisible ? 'text' : type}
          className={twMerge(
            `peer w-full py-2 pr-4 bg-transparent placeholder:opacity-0 placeholder:transition-color placeholder:duration-300 focus:placeholder:opacity-100 text-md placeholder-gray focus:outline-none transition-all duration-300 border-b
            disabled:text-gray-disabled disabled:placeholder-gray-disabled
            ${error ? 'border-red-600 text-red-600' : 'text-black border-black disabled:border-gray-disabled'}
            ${!icon && type !== 'password' ? 'pl-2' : 'pl-10'} ${focusTextClass[focusColor]}`,
            className,
          )}
        />
        <label
          htmlFor={id}
          className={`absolute text-md pointer-events-none transition-all duration-300 origin-left peer-focus:-translate-y-6 peer-focus:scale-75 peer-disabled:text-gray-disabled
          ${error ? 'text-red-600' : `text-black ${peerFocusTextClass[focusColor]}`}
          ${isFilled ? '-translate-y-6 scale-75' : ''}
          ${!icon && type !== 'password' ? 'left-2' : 'left-10'}
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
        <button
          className={`absolute text-xl left-2 size-5 transition-colors duration-300 peer-disabled:text-gray-disabled peer-disabled:pointer-events-none
            ${error ? 'text-red-600' : peerFocusTextClass[focusColor]}
            ${isInteractive ? 'cursor-pointer ' : 'pointer-events-none'}`}
          onMouseDown={localOnIconClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              localOnIconClick(e);
            }
          }}
          tabIndex={isInteractive && iconTabbable ? 0 : -1}
          type="button"
          // Password toggle is a real control → labelled + state announced; a purely
          // decorative leading icon is hidden from assistive tech.
          aria-hidden={!isInteractive || undefined}
          aria-label={
            type === 'password'
              ? t(
                  isPasswordVisible
                    ? 'components.customInput.hidePassword'
                    : 'components.customInput.showPassword',
                )
              : undefined
          }
          aria-pressed={type === 'password' ? isPasswordVisible : undefined}
        >
          <div ref={iconButtonRef} aria-hidden className="size-full">
            {iconToShow}
          </div>
        </button>
        <hr
          className={`absolute border-none bottom-0 left-0 max-w-full w-full h-0.5 origin-left scale-x-0 transition-transform duration-300 peer-focus:scale-x-100
            ${error ? 'bg-red-600' : bgClass[focusColor]}
          `}
        />
      </div>
    );
  },
);

export default CustomInput;
