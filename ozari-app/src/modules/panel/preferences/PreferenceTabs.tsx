import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PREFERENCE_TABS, type PreferenceTab } from './preferencesSearch';

const KEY = 'modules.panel.preferences.tabs';

/**
 * The preferences group switch — the same segmented-control language as Agenda/Historial, widened to
 * N segments: real tabs semantics (`tablist`/`tab`, roving tabindex, automatic activation), one shared
 * white pill that SLIDES between segments (binary-ish UI state ⇒ a CSS transition per the GSAP/CSS
 * division rule, on the settle curve), and `focus-visible` so the keyboard ring never flashes on a
 * pointer click.
 *
 * The pill is positioned by a `translate` of its own width per index — remember the v4 trap: those
 * utilities emit the `translate` property, so the transition has to name it explicitly or the pill
 * would jump.
 *
 * The selected group is URL state (`preferencesSearch`), like Agenda/Historial — a reload or a shared
 * link lands where the admin was working. This component only reports the intent; the page writes it.
 *
 * Deliberately a separate component from `OrdersViewSwitch` rather than a shared abstraction: that one
 * is welded to its own two-view copy and search shape. If a third consumer appears, THEN generalise —
 * two similar 60-line controls are cheaper than a premature one with five props.
 */
const PreferenceTabs: React.FC<{
  tab: PreferenceTab;
  onChange: (tab: PreferenceTab) => void;
}> = ({ tab, onChange }) => {
  const { t } = useTranslation();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const activate = (index: number): void => {
    const next = PREFERENCE_TABS[index];
    /* v8 ignore next -- defensive: every caller derives `index` from PREFERENCE_TABS itself */
    if (next === undefined) return;
    tabs.current[index]?.focus();
    if (next !== tab) onChange(next);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const current = PREFERENCE_TABS.indexOf(tab);
    const last = PREFERENCE_TABS.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (current + 1) % PREFERENCE_TABS.length
        : event.key === 'ArrowLeft'
          ? (current - 1 + PREFERENCE_TABS.length) % PREFERENCE_TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    activate(target);
  };

  const index = PREFERENCE_TABS.indexOf(tab);

  return (
    <div
      role="tablist"
      aria-label={t(`${KEY}.label`)}
      className="relative grid w-full grid-cols-3 rounded-full bg-charcoal/5 p-1 sm:w-auto"
      onKeyDown={onKeyDown}
    >
      {/* The shared selection pill: one segment wide (minus the 4px inset), slid by its own width per
          index. Decorative — the buttons carry the semantics. */}
      <span
        aria-hidden
        style={{ translate: `${index * 100}%` }}
        className="pointer-events-none absolute inset-y-1 left-1 w-[calc(33.333%-0.1667rem)] rounded-full bg-white shadow-sm transition-[translate] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none"
      />
      {PREFERENCE_TABS.map((option, optionIndex) => {
        const selected = option === tab;
        return (
          <button
            key={option}
            ref={(element) => {
              tabs.current[optionIndex] = element;
            }}
            type="button"
            role="tab"
            id={`preferences-tab-${option}`}
            aria-selected={selected}
            aria-controls="preferences-tab-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => activate(optionIndex)}
            className={`relative cursor-pointer rounded-full px-4 py-1.5 text-center text-xs font-semibold transition-[color] duration-300 ease-[var(--ease-settle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/40 ${
              selected ? 'text-charcoal' : 'text-charcoal/50 hover:text-charcoal/80'
            }`}
          >
            {t(`${KEY}.${option}`)}
          </button>
        );
      })}
    </div>
  );
};

export default PreferenceTabs;
