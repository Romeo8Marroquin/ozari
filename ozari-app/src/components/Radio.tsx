import React, { forwardRef, useId } from 'react';
import { twMerge } from 'tailwind-merge';

export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Clickable label shown next to the dot (already-translated text). */
  label?: React.ReactNode;
  /** Principal color used when selected / on hover / focus (defaults to magenta). */
  color?: string;
}

/**
 * Accessible custom radio — the circular sibling of {@link Checkbox}, sharing its exact motion
 * language: a visually-hidden native `<input type="radio">` (full keyboard + arrow-key grouping via
 * `name`, plus form/RHF behaviour) under a styled ring. The ring + inner dot transition smoothly
 * (~200ms, like the Button/Checkbox) on select; hover is a soft halo (never a border jump), and
 * keyboard focus grows a stronger ring. Only the ring + label are clickable (a `w-fit` `<label>`).
 */
const Radio = forwardRef<HTMLInputElement, RadioProps>(
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
            type="radio"
            disabled={disabled}
            className="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            {...props}
          />
          {/* Ring — border/halo driven by the input's :checked/:hover/:focus-visible (soft halo on
              hover, stronger ring on keyboard focus), matching the Checkbox exactly. */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-gray-300 bg-white transition-[border-color,box-shadow] duration-200 ease-out
              peer-checked:border-[var(--cb)]
              peer-hover:shadow-[0_0_0_4px_var(--cb-halo)]
              peer-focus-visible:border-[var(--cb)] peer-focus-visible:shadow-[0_0_0_3px_var(--cb-ring)]
              motion-reduce:transition-none"
          />
          {/* Dot — absolutely centered (auto-margins) so it stays concentric with the ring, fading +
              scaling in over the same 200ms as the ring colour. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 m-auto size-2.5 scale-0 rounded-full bg-[var(--cb)] opacity-0 transition-[opacity,scale] duration-200 ease-out peer-checked:scale-100 peer-checked:opacity-100 motion-reduce:transition-none"
          />
        </span>
        {label && <span className="text-xs leading-5 text-gray-600">{label}</span>}
      </label>
    );
  },
);

Radio.displayName = 'Radio';

export default Radio;
