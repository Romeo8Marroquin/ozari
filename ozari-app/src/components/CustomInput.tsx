import { forwardRef, useCallback, useState } from 'react';
import { twMerge } from 'tailwind-merge';

interface CustomInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon: React.ReactNode;
  label: string;
  enableIconPointerEvents?: boolean;
  focusColor?: string;
  onIconClick?: () => void;
}

const CustomInput = forwardRef<HTMLInputElement, CustomInputProps>(
  (
    {
      id,
      icon,
      className,
      enableIconPointerEvents: enablePointerEvents,
      focusColor = 'midnight',
      label,
      onFocus,
      onBlur,
      onIconClick,
      ...props
    }: CustomInputProps,
    ref,
  ) => {
    const [isFilled, setIsFilled] = useState(false);

    const localOnIconClick = useCallback(() => {
      onIconClick?.();
    }, [onIconClick]);

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
    return (
      <div className="relative flex items-center justify-center w-fit">
        <input
          ref={ref}
          {...props}
          onFocus={localFocus}
          onBlur={localBlur}
          className={twMerge(
            `peer w-fit py-2 pr-4 bg-transparent text-black placeholder:opacity-0 placeholder:transition-color placeholder:duration-300 focus:placeholder:opacity-100 text-md placeholder-gray focus:outline-none transition-all duration-300 border-b border-gray
            disabled:text-gray-disabled disabled:placeholder-gray-disabled
            ${!icon ? 'pl-3' : 'pl-10'} focus:text-${focusColor}`,
            className,
          )}
        />
        <label
          htmlFor={id}
          className={`absolute text-black peer-focus:text-${focusColor} text-md pointer-events-none transition-all duration-300 origin-left peer-focus:-translate-y-6 peer-focus:scale-75 peer-disabled:text-gray-disabled
          ${isFilled ? '-translate-y-6 scale-75' : ''}
          ${!icon ? 'left-3' : 'left-10'}
        `}
        >
          {label}
        </label>
        <button
          className={`absolute left-3 peer-focus:text-${focusColor} transition-colors duration-300 peer-disabled:text-gray-disabled ${enablePointerEvents ? 'pointer-events-auto' : 'pointer-events-none'}`}
          onClick={localOnIconClick}
          tabIndex={0}
        >
          {icon}
        </button>
        <hr
          className={`absolute border-none z-10 bottom-0 left-0 max-w-full w-full h-0.5 bg-${focusColor} origin-left scale-x-0 transition-transform duration-300 peer-focus:scale-x-100 peer-disabled:hidden`}
        />
      </div>
    );
  },
);

export default CustomInput;
