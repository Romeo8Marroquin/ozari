import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ORDERS_VIEWS, type OrdersView } from './ordersSearch';

const KEY = 'modules.panel.orders.views';

/** The i18n leaf for a view's label (the URL says `historial`; the copy keys say `history`). */
const labelKeyFor = (view: OrdersView): string => (view === 'historial' ? 'history' : 'agenda');

/**
 * The Agenda / Historial segmented control — proper **tabs semantics** (`tablist`/`tab`, roving
 * tabindex, automatic activation): Left/Right/Home/End move AND select, Tab leaves the group, and
 * the page's list panel is labelled by the active tab (`orders-view-panel`). The selection is ONE
 * shared white pill that **slides** between the two equal segments (binary UI state ⇒ a CSS
 * transition per the GSAP/CSS division rule, on the settle curve and roughly the body-swap's
 * tempo — the pill glides while the old list exits, and lands as the new one enters). Remember
 * the v4 trap: `translate-x-*` emits the `translate` property, so the transition names it
 * explicitly. `focus-visible` carries the keyboard ring without flashing it on pointer clicks.
 */
const OrdersViewSwitch: React.FC<{
  view: OrdersView;
  onChange: (view: OrdersView) => void;
}> = ({ view, onChange }) => {
  const { t } = useTranslation();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const activate = (index: number): void => {
    const next = ORDERS_VIEWS[index];
    /* v8 ignore next -- defensive: every caller derives `index` from ORDERS_VIEWS itself */
    if (next === undefined) return;
    tabs.current[index]?.focus();
    if (next !== view) onChange(next);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const current = ORDERS_VIEWS.indexOf(view);
    const last = ORDERS_VIEWS.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (current + 1) % ORDERS_VIEWS.length
        : event.key === 'ArrowLeft'
          ? (current - 1 + ORDERS_VIEWS.length) % ORDERS_VIEWS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    activate(target);
  };

  return (
    <div
      role="tablist"
      aria-label={t(`${KEY}.label`)}
      className="relative inline-grid grid-cols-2 rounded-full bg-charcoal/5 p-1"
      onKeyDown={onKeyDown}
    >
      {/* The shared selection pill: half the track wide (minus the 4px inset on each side), slid to
          the second segment by its own width. Decorative — the tabs carry the semantics. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white shadow-sm transition-[translate] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
          view === 'historial' ? 'translate-x-full' : ''
        }`}
      />
      {ORDERS_VIEWS.map((option, index) => {
        const selected = option === view;
        return (
          <button
            key={option}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`orders-tab-${option}`}
            aria-selected={selected}
            aria-controls="orders-view-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => activate(index)}
            className={`relative cursor-pointer rounded-full px-4 py-1.5 text-center text-xs font-semibold transition-[color] duration-300 ease-[var(--ease-settle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/40 ${
              selected ? 'text-charcoal' : 'text-charcoal/50 hover:text-charcoal/80'
            }`}
          >
            {t(`${KEY}.${labelKeyFor(option)}`)}
          </button>
        );
      })}
    </div>
  );
};

export default OrdersViewSwitch;
