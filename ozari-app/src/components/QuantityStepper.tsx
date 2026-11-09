import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiMinus, HiOutlineTrash, HiPlus } from 'react-icons/hi2';
import { toIntegerText } from '@utils/numericInput';

interface QuantityStepperProps {
  /** The current quantity (≥ 1 while the thing is held). */
  value: number;
  /** The most it may reach; `undefined` = no known ceiling. */
  max?: number;
  /** The new quantity — `0` means "take it out" (the minus at 1, which wears a trash can). */
  onChange: (value: number) => void;
  /** The accessible name of the group and its number field ("Cantidad de Mantel"). */
  label: string;
  /** `md` (36px controls) where there is room; `sm` (32px) in a popover. */
  size?: 'sm' | 'md';
  autoFocus?: boolean;
}

const SIZES = {
  sm: { button: 'size-8', icon: 'size-4', input: 'w-9 text-sm' },
  md: { button: 'size-9', icon: 'size-4.5', input: 'w-11 text-base' },
} as const;

/**
 * A pill with − / the number / + — the quantity control of the order sketch (the admin's cart).
 *
 * - **The minus at 1 becomes a trash can** (the two icons cross-fade in place — binary state, so CSS):
 *   at one unit "one less" means "not at all", and saying so beats a minus that silently deletes.
 * - **The plus stops at `max`** (the takeable amount for the cart's dates) and says why in its name.
 * - **The number can be typed**: a `type="text"` + numeric keypad field (`toIntegerText`, never
 *   `type="number"` — numericInput.ts), committed on blur or Enter, clamped to `[1, max]`; an empty or
 *   zero entry puts back what was there (taking a line OUT is the trash can's job, never a typo's).
 */
const QuantityStepper: React.FC<QuantityStepperProps> = ({
  value,
  max,
  onChange,
  label,
  size = 'md',
  autoFocus = false,
}) => {
  const { t } = useTranslation();
  // What is being typed, while it is (null = show the value).
  const [draft, setDraft] = useState<string | null>(null);
  const sizes = SIZES[size];
  const atMax = max !== undefined && value >= max;
  const removing = value <= 1;

  const commit = (): void => {
    if (draft === null) return;
    setDraft(null);
    const typed = Number(draft);
    if (draft === '' || typed < 1) return;
    const next = max !== undefined ? Math.min(typed, Math.max(max, 1)) : typed;
    if (next !== value) onChange(next);
  };

  const control = `grid ${sizes.button} shrink-0 cursor-pointer place-items-center rounded-full transition-[color,background-color,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none`;
  const icon = `col-start-1 row-start-1 ${sizes.icon} transition-[opacity,scale] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none`;

  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center rounded-full bg-white p-1 shadow-sm ring-1 ring-charcoal/[0.08]"
    >
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        aria-label={removing ? t('components.quantityStepper.remove') : t('components.quantityStepper.decrease')}
        className={`${control} ${removing ? 'text-red-600 hover:bg-red-50' : 'text-charcoal/70 hover:bg-charcoal/[0.06] hover:text-charcoal'}`}
      >
        <span aria-hidden className="grid">
          <HiMinus className={`${icon} ${removing ? 'scale-50 opacity-0' : 'scale-100 opacity-100'}`} />
          <HiOutlineTrash className={`${icon} ${removing ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`} />
        </span>
      </button>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        // Focus is a DEVICE decision — the caller asks only on a fine pointer.
        autoFocus={autoFocus}
        aria-label={label}
        value={draft ?? String(value)}
        onFocus={(event) => {
          setDraft(String(value));
          event.currentTarget.select();
        }}
        onChange={(event) => setDraft(toIntegerText(event.target.value))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        className={`${sizes.input} min-w-0 bg-transparent text-center font-semibold tabular-nums text-charcoal focus:outline-none`}
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={atMax}
        aria-label={atMax ? t('components.quantityStepper.atMax') : t('components.quantityStepper.increase')}
        className={`${control} text-charcoal/70 enabled:hover:bg-charcoal/[0.06] enabled:hover:text-charcoal`}
      >
        <HiPlus aria-hidden className={sizes.icon} />
      </button>
    </div>
  );
};

export default QuantityStepper;
