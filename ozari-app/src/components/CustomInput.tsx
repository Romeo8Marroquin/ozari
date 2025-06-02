import gsap from 'gsap';
import { forwardRef, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiEye, HiEyeSlash } from 'react-icons/hi2';
import { twMerge } from 'tailwind-merge';

interface CustomInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  enableIconPointerEvents?: boolean;
  focusColor?: string;
  icon?: React.ReactNode;
  error?: boolean;
  isRequired?: boolean;
  optionalLabel?: boolean;
  onIconClick?: () => void;
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
      onFocus,
      onBlur,
      onIconClick,
      ...props
    }: CustomInputProps,
    ref,
  ) => {
    const { t } = useTranslation();
    const [isFilled, setIsFilled] = useState(Boolean(props.value));
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const iconButtonRef = useRef<HTMLDivElement>(null);

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

    const localFocus = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        setIsFilled(Boolean(e.target.value));
        onFocus?.(e);
      },
      [onFocus],
    );

    const localBlur = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        setIsFilled(Boolean(e.target.value));
        onBlur?.(e);
      },
      [onBlur],
    );
    const passwordIcon = isPasswordVisible ? <HiEyeSlash /> : <HiEye />;
    const iconToShow = type === 'password' ? passwordIcon : icon;
    return (
      <div className="relative flex items-center justify-center w-full">
        <input
          ref={ref}
          {...props}
          disabled={disabled}
          onFocus={localFocus}
          onBlur={localBlur}
          type={isPasswordVisible ? 'text' : type}
          className={twMerge(
            `peer w-full py-2 pr-4 bg-transparent placeholder:opacity-0 placeholder:transition-color placeholder:duration-300 focus:placeholder:opacity-100 text-md placeholder-gray focus:outline-none transition-all duration-300 border-b
            disabled:text-gray-disabled disabled:placeholder-gray-disabled
            ${error ? 'border-red-600 text-red-600' : 'text-black border-gray'}
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
            <span className="ml-[0.1rem]">{t('components.customInput.requiredField')}</span>
          )}
          {optionalLabel && !isRequired && (
            <span className="ml-[0.1rem]">{t('components.customInput.optionalField')}</span>
          )}
        </label>
        <button
          className={`absolute text-xl left-2 size-5 transition-colors duration-300 peer-disabled:text-gray-disabled peer-disabled:pointer-events-none
            ${error ? 'text-red-600' : peerFocusTextClass[focusColor]}
            ${enablePointerEvents || type === 'password' ? 'cursor-pointer ' : 'pointer-events-none'}`}
          onMouseDown={localOnIconClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              localOnIconClick(e);
            }
          }}
          tabIndex={0}
          type="button"
        >
          <div ref={iconButtonRef} className="size-full">
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
