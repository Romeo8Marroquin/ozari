import React, { forwardRef } from 'react';
import { twMerge } from 'tailwind-merge';

type ButtonVariant = 'solid' | 'outline' | 'soft' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Emphasis. `solid` is the filled primary; the rest are progressively lighter. */
  variant?: ButtonVariant;
  /** Principal color (any CSS color). Every other shade is derived from it. */
  color?: string;
  /** Label color for the `solid` variant (defaults to white). */
  textColor?: string;
  size?: ButtonSize;
  /** Fully rounded instead of the size's default radius. */
  pill?: boolean;
  /** Show a spinner, block interaction, and set `aria-busy` — without any width shift. */
  loading?: boolean;
  /** Stretch to the container width (used on the auth forms). */
  fullWidth?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-11 gap-1.5 px-3.5 text-sm',
  md: 'h-[52px] gap-2 px-5 text-[15px]',
  lg: 'h-[60px] gap-2 px-6 text-base',
};

const RADII: Record<ButtonSize, string> = {
  sm: 'rounded-[10px]',
  md: 'rounded-[14px]',
  lg: 'rounded-[16px]',
};

const SPINNER: Record<ButtonSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-[18px] w-[18px]',
  lg: 'h-5 w-5',
};

// Interaction is scoped to `enabled:` so a disabled button never lifts/darkens, and
// `motion-reduce:` strips the transform feedback (the color change is kept, instant).
const VARIANTS: Record<ButtonVariant, string> = {
  solid:
    'bg-[var(--btn)] text-[var(--btn-fg)] shadow-sm ' +
    'enabled:hover:bg-[var(--btn-hover)] enabled:hover:-translate-y-px enabled:hover:shadow-md ' +
    'enabled:active:bg-[var(--btn-active)] enabled:active:translate-y-0 enabled:active:scale-[.985] enabled:active:shadow-sm ' +
    'disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none',
  outline:
    'border-2 border-[var(--btn)] text-[var(--btn)] bg-transparent ' +
    'enabled:hover:bg-[var(--btn-soft)] enabled:hover:-translate-y-px ' +
    'enabled:active:bg-[var(--btn-soft-strong)] enabled:active:translate-y-0 enabled:active:scale-[.985] ' +
    'disabled:border-gray-200 disabled:text-gray-400',
  soft:
    'bg-[var(--btn-soft)] text-[var(--btn)] ' +
    'enabled:hover:bg-[var(--btn-soft-strong)] enabled:hover:-translate-y-px ' +
    'enabled:active:translate-y-0 enabled:active:scale-[.985] ' +
    'disabled:bg-gray-100 disabled:text-gray-400',
  ghost:
    'bg-transparent text-[var(--btn)] ' +
    'enabled:hover:bg-[var(--btn-soft)] enabled:active:scale-[.985] ' +
    'disabled:text-gray-400',
};

const BASE =
  'relative inline-flex select-none items-center justify-center whitespace-nowrap font-semibold ' +
  'cursor-pointer outline-none transition duration-200 ease-out motion-reduce:transition-none ' +
  'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--btn-ring)] ' +
  'disabled:cursor-not-allowed';

/**
 * The app's primary action button: one filled, color-customizable, accessible primitive.
 * Everything visual derives from a single `color` (like the notifications): hover darkens,
 * press settles + scales, focus shows a ring, disabled is clearly inert. Colors are injected
 * as CSS variables so the state changes stay pure CSS (no per-frame JS) for any color.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'solid',
      color = '#1d1b1e',
      textColor = '#ffffff',
      size = 'md',
      pill = false,
      loading = false,
      fullWidth = false,
      startIcon,
      endIcon,
      type = 'button',
      disabled,
      className,
      style,
      children,
      ...rest
    },
    ref,
  ) => {
    /* v8 ignore next 3 -- dev-only a11y warning; `import.meta.env.DEV` is false under test */
    if (import.meta.env.DEV && !children && !rest['aria-label'] && (startIcon || endIcon)) {
      console.warn('[Button] An icon-only button needs an `aria-label` for screen readers.');
    }

    const colorVars = {
      '--btn': color,
      '--btn-fg': textColor,
      '--btn-hover': `color-mix(in srgb, ${color} 88%, #000)`,
      '--btn-active': `color-mix(in srgb, ${color} 80%, #000)`,
      '--btn-ring': color,
      '--btn-soft': `color-mix(in srgb, ${color} 12%, transparent)`,
      '--btn-soft-strong': `color-mix(in srgb, ${color} 20%, transparent)`,
      ...style,
    } as React.CSSProperties;

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={twMerge(
          BASE,
          SIZES[size],
          pill ? 'rounded-full' : RADII[size],
          VARIANTS[variant],
          fullWidth && 'w-full',
          className,
        )}
        style={colorVars}
        {...rest}
      >
        {/* Label stays in layout while loading (opacity 0) so the width never jumps. */}
        <span
          className={twMerge(
            'inline-flex items-center gap-2 transition-opacity duration-150 motion-reduce:transition-none',
            loading && 'opacity-0',
          )}
        >
          {startIcon && <span className="inline-flex shrink-0">{startIcon}</span>}
          {children}
          {endIcon && <span className="inline-flex shrink-0">{endIcon}</span>}
        </span>

        <span
          aria-hidden
          className={twMerge(
            'absolute inset-0 inline-flex items-center justify-center transition-opacity duration-150 motion-reduce:transition-none',
            loading ? 'opacity-100' : 'opacity-0',
          )}
        >
          <span
            className={twMerge(
              'rounded-full border-2 border-current border-t-transparent',
              loading && 'animate-spin motion-reduce:animate-none',
              SPINNER[size],
            )}
          />
        </span>
      </button>
    );
  },
);

Button.displayName = 'Button';

export default Button;
