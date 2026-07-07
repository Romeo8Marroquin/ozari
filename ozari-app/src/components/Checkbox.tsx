import React, { forwardRef, useId } from 'react';
import { twMerge } from 'tailwind-merge';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Clickable label shown next to the box (already-translated text). */
  label?: React.ReactNode;
  /** Principal color used when checked / on hover / focus (defaults to magenta). */
  color?: string;
}

/**
 * Accessible custom checkbox: a visually-hidden native `<input type="checkbox">` (keeps
 * full keyboard + form/RHF behaviour) under a styled box. The box and check transition
 * smoothly (~200ms, like the Button) on check/uncheck — the native control toggles
 * instantly, so the custom visual is what gives the soft animation. Only the box + label
 * are clickable (it's a `w-fit` `<label>`), not the rest of the row.
 */
const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, color = '#ff01ed', className, id, disabled, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;

    const colorVars = {
      '--cb': color,
      '--cb-halo': `color-mix(in srgb, ${color} 28%, transparent)`,
      '--cb-ring': `color-mix(in srgb, ${color} 45%, transparent)`,
    } as React.CSSProperties;

    return (
      <label
        htmlFor={inputId}
        style={colorVars}
        className={twMerge(
          'inline-flex w-fit cursor-pointer items-center gap-2.5 select-none',
          disabled && 'cursor-not-allowed opacity-60',
          className,
        )}
      >
        <span className="relative grid size-5 shrink-0 place-items-center">
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            disabled={disabled}
            className="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            {...props}
          />
          {/* Box — color/halo all driven by the input's :checked/:hover/:focus-visible.
              Hover is a soft ring halo (matching the Switch), never a border-color jump, so it
              stays smooth and never looks "almost checked"; focus-visible grows the stronger ring
              for keyboard. */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-[6px] border-2 border-gray-300 bg-white transition-[background-color,border-color,box-shadow] duration-200 ease-out
              peer-checked:border-[var(--cb)] peer-checked:bg-[var(--cb)]
              peer-hover:shadow-[0_0_0_4px_var(--cb-halo)]
              peer-focus-visible:border-[var(--cb)] peer-focus-visible:shadow-[0_0_0_3px_var(--cb-ring)]
              motion-reduce:transition-none"
          />
          {/* Check — fades + scales in over the same 200ms as the fill. */}
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none relative size-3.5 scale-50 text-white opacity-0 transition-[opacity,transform] duration-200 ease-out peer-checked:scale-100 peer-checked:opacity-100 motion-reduce:transition-none"
          >
            <path d="M5 12.5 10 17.5 19 7" />
          </svg>
        </span>
        {label && <span className="text-xs leading-5 text-gray-600">{label}</span>}
      </label>
    );
  },
);

Checkbox.displayName = 'Checkbox';

export default Checkbox;
