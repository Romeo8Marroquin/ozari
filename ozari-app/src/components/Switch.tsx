import React, { forwardRef, useId } from 'react';
import { twMerge } from 'tailwind-merge';

export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'onChange'> {
  /** Controlled on/off state. */
  checked: boolean;
  /** Fired with the requested next state on user toggle (omit for a read-only/`disabled` status). */
  onChange?: (checked: boolean) => void;
  /** Principal color used for the "on" track, hover halo and focus ring (defaults to magenta). */
  color?: string;
  /** Optional clickable label shown next to the track. */
  label?: React.ReactNode;
}

/**
 * Accessible switch primitive — a visually-hidden native `<input role="switch">` (full keyboard +
 * form behaviour) under a styled track + knob, matching the {@link Checkbox} language. Every state
 * change is CSS-driven and smooth (~200ms): the track colour crossfades on toggle, the knob eases
 * across on the shared `--ease-settle` curve and dips slightly on press, hovering raises a soft
 * colour halo, and keyboard focus grows a transitioned ring (no sudden pop). State is conveyed by
 * position + colour, so a `disabled` switch stays solid (it just loses the halo/ring/pointer) rather
 * than fading. Colours derive from a single `color`, injected as CSS variables like the Button.
 */
const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ checked, onChange, color = '#ff01ed', disabled, className, id, label, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;

    const colorVars = {
      '--sw': color,
      '--sw-halo': `color-mix(in srgb, ${color} 28%, transparent)`,
      '--sw-ring': `color-mix(in srgb, ${color} 45%, transparent)`,
    } as React.CSSProperties;

    return (
      <label
        htmlFor={inputId}
        style={colorVars}
        className={twMerge(
          'group inline-flex w-fit items-center gap-3 select-none',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          className,
        )}
      >
        <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            role="switch"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange?.(event.target.checked)}
            className="peer absolute inset-0 z-[2] m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            {...props}
          />
          {/* Track — colour + focus ring all driven by the input's :checked/:focus-visible; the hover
              halo is `group-hover` and only wired when interactive, so a disabled/status switch shows
              no affordance. */}
          <span
            aria-hidden
            className={twMerge(
              `absolute inset-0 rounded-full bg-charcoal/20 transition-[background-color,box-shadow] duration-200 ease-out
               peer-checked:bg-[var(--sw)]
               peer-focus-visible:shadow-[0_0_0_3px_var(--sw-ring)]
               motion-reduce:transition-none`,
              !disabled && 'group-hover:shadow-[0_0_0_4px_var(--sw-halo)]',
            )}
          />
          {/* Knob — eases across on toggle and dips on press. */}
          <span
            aria-hidden
            className="pointer-events-none relative z-[1] ml-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--ease-settle)] peer-checked:translate-x-5 peer-active:scale-90 motion-reduce:transition-none"
          />
        </span>
        {label && <span className="text-sm text-charcoal">{label}</span>}
      </label>
    );
  },
);

Switch.displayName = 'Switch';

export default Switch;
