import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ORDER_MODES, type OrderMode } from './SchemaCreateOrder';

const KEY = 'modules.panel.orders.create.mode';

/**
 * The "¿Rentar, comprar o ambos?" fork — step zero of the order (Q-A). A proper **radiogroup**
 * (not tabs: this changes what the form MEANS, it doesn't switch views of the same content):
 * roving tabindex, Left/Right/Up/Down + Home/End move-and-select, Space/Enter select. The three
 * equal segments share one sliding pill (binary UI state ⇒ a CSS transition on the settle curve;
 * `translate-*` names the property it animates, per the Tailwind v4 trap).
 */
const OrderModeSelect: React.FC<{
  value: OrderMode;
  onChange: (mode: OrderMode) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const { t } = useTranslation();
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const index = ORDER_MODES.indexOf(value);

  const select = (next: number): void => {
    const mode = ORDER_MODES[next];
    /* v8 ignore next -- defensive: every caller derives `next` from ORDER_MODES itself */
    if (mode === undefined) return;
    radios.current[next]?.focus();
    if (mode !== value) onChange(mode);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const last = ORDER_MODES.length - 1;
    const target =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (index + 1) % ORDER_MODES.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (index - 1 + ORDER_MODES.length) % ORDER_MODES.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    select(target);
  };

  return (
    <div
      role="radiogroup"
      aria-label={t(`${KEY}.label`)}
      className="relative grid grid-cols-3 rounded-full bg-charcoal/5 p-1"
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(33.333%-0.1875rem)] rounded-full bg-white shadow-sm transition-[translate] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
          index === 1 ? 'translate-x-full' : index === 2 ? 'translate-x-[200%]' : ''
        }`}
      />
      {ORDER_MODES.map((mode, i) => {
        const selected = mode === value;
        return (
          <button
            key={mode}
            ref={(el) => {
              radios.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => select(i)}
            className={`relative cursor-pointer rounded-full px-3 py-1.5 text-center text-xs font-semibold transition-[color] duration-300 ease-[var(--ease-settle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/40 disabled:cursor-not-allowed disabled:opacity-60 ${
              selected ? 'text-charcoal' : 'text-charcoal/50 hover:text-charcoal/80'
            }`}
          >
            {t(`${KEY}.${mode}`)}
          </button>
        );
      })}
    </div>
  );
};

export default OrderModeSelect;
