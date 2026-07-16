import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { twMerge } from 'tailwind-merge';

interface CustomTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  focusColor?: string;
  error?: boolean;
  isRequired?: boolean;
  optionalLabel?: boolean;
  /**
   * Grow with the content instead of showing the native resize handle / inner scrollbar: the
   * height EASES to always be the content **plus one spare empty line**, so the card and
   * everything below reflow smoothly — one page scrollbar, never a nested one. The spare line is
   * the anti-jump trick: when typing wraps onto a new line, the browser re-lays the text out
   * INSTANTLY (no transition can stop that), so the new line must land in space that already
   * exists — then only the buffer grows underneath, smoothly. (`rows` is ignored in this mode;
   * empty = one text line + the spare = the two-line resting state.)
   */
  autoGrow?: boolean;
}

/** jsdom (and `line-height: normal`) report no numeric line-height — a sane text-md fallback. */
const FALLBACK_LINE_HEIGHT_PX = 24;

const peerFocusTextClass: Record<string, string> = {
  midnight: 'peer-focus:text-midnight',
};

const bgClass: Record<string, string> = {
  midnight: 'bg-midnight',
};

/**
 * The multi-line sibling of {@link CustomInput}: same underline field, floating label, animated
 * focus rule and error state — minus the icon/password machinery a textarea never needs. Manual
 * vertical resize by default; `autoGrow` replaces the handle with smooth grow-as-you-type.
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
      autoGrow = false,
      onChange,
      ...props
    }: CustomTextareaProps,
    ref,
  ) => {
    const { t } = useTranslation();
    const [isFilledOnChange, setIsFilledOnChange] = useState(Boolean(props.value));
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    const combinedRef = useCallback(
      (element: HTMLTextAreaElement | null) => {
        innerRef.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      },
      [ref],
    );

    // Auto-grow: after every render (the value is controlled, so typing/reset re-renders), ease the
    // height to the content **plus one spare line** (see the `autoGrow` doc: the spare line is what
    // absorbs a wrap without the text jumping). Measured with height:auto, then animated FROM the
    // previous explicit height TO the target via the CSS height transition.
    useLayoutEffect(() => {
      if (!autoGrow) return;
      const el = innerRef.current;
      /* v8 ignore next -- the textarea is always mounted */
      if (!el) return;
      const previous = el.style.height;
      el.style.height = 'auto';
      const lineHeight =
        Number.parseFloat(getComputedStyle(el).lineHeight) || FALLBACK_LINE_HEIGHT_PX;
      const target = `${el.scrollHeight + lineHeight}px`;
      // Restore the previous height so the transition has a real FROM, then commit the target.
      el.style.height = previous || target;
      void el.offsetHeight; // force the reflow that separates from → to
      el.style.height = target;
    });

    const localChange = useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setIsFilledOnChange(Boolean(event.target.value));
        onChange?.(event);
      },
      [onChange],
    );

    // Controlled (every RHF wrapper passes `value`) → the live value decides, so a programmatic
    // reset drops the label; the onChange-tracked state is only the uncontrolled fallback.
    const isFilled = props.value !== undefined ? Boolean(props.value) : isFilledOnChange;

    return (
      <div className="relative flex items-start justify-center w-full">
        <textarea
          ref={combinedRef}
          {...props}
          id={id}
          // autoGrow measures pure CONTENT height (+ its own spare line); a larger `rows` would
          // inflate scrollHeight and break the measurement, so it pins the native floor to 1.
          rows={autoGrow ? 1 : rows}
          disabled={disabled}
          aria-invalid={error || undefined}
          aria-required={isRequired || undefined}
          onChange={localChange}
          className={twMerge(
            `peer w-full resize-y py-2 pl-2 pr-4 bg-transparent placeholder:opacity-0 placeholder:transition-color placeholder:duration-300 focus:placeholder:opacity-100 text-md placeholder-gray focus:outline-none transition-all duration-300 border-b
            disabled:text-gray-disabled disabled:placeholder-gray-disabled
            ${error ? 'border-red-600 text-red-600' : 'text-black border-black disabled:border-gray-disabled'}
            ${autoGrow ? 'resize-none overflow-hidden transition-[height] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none' : ''}`,
            className,
          )}
        />
        {/* `truncate` + max-width: an overlong label ellipsizes on ONE line instead of wrapping
            (see CustomInput — same doctrine). */}
        <label
          htmlFor={id}
          className={`absolute left-2 top-2 text-md pointer-events-none transition-all duration-300 origin-left peer-focus:-translate-y-6 peer-focus:scale-75 peer-disabled:text-gray-disabled truncate max-w-[calc(100%-1rem)]
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
