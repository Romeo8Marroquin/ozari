import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useBreakpoint from '@hooks/useBreakpoint';
import { PREFERENCE_TABS, type PreferenceTab } from './preferencesSearch';

const KEY = 'modules.panel.preferences.tabs';

/** Segments per line on a PHONE. Four Spanish group names ("Documentos" is the widest) need about
 *  90px each to be read whole; a 320px screen leaves the track 280px, so four across is 70px and
 *  the last label simply painted outside the pill. Two per line is 140px — room for a name twice as
 *  long as any we have, which is what keeps this from breaking again on the next group. */
const COMPACT_COLUMNS = 2;

/**
 * The preferences group switch — the same segmented-control language as Agenda/Historial, widened to
 * N segments: real tabs semantics (`tablist`/`tab`, roving tabindex, automatic activation), one shared
 * white pill that SLIDES between segments (binary-ish UI state ⇒ a CSS transition per the GSAP/CSS
 * division rule, on the settle curve), and `focus-visible` so the keyboard ring never flashes on a
 * pointer click.
 *
 * The pill is positioned by a `translate` of its own size per index — remember the v4 trap: those
 * utilities emit the `translate` property, so the transition has to name it explicitly or the pill
 * would jump.
 *
 * **It WRAPS on a phone rather than truncating or scrolling.** A segmented control's whole promise
 * is that every option is visible at once, so the two usual escapes both cost more than they save:
 * an ellipsis hides the word that distinguishes the groups ("Docum…"), and a scrolling track hides
 * a group entirely behind a gesture nothing announces. Two lines of two costs a few pixels of
 * height and keeps the promise — and the pill still slides, now diagonally.
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
  const { isMobile } = useBreakpoint();
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
  const count = PREFERENCE_TABS.length;
  // The grid comes from the LIST, never from a hardcoded `grid-cols-3`: adding a group is one entry
  // in `PREFERENCE_TABS`, and a control that silently kept three columns would overflow its own
  // pill. `isMobile` is briefly undefined pre-effect — treat that as the narrow case, like every
  // other consumer of this hook.
  const columns = isMobile === false ? count : Math.min(count, COMPACT_COLUMNS);
  const rows = Math.ceil(count / columns);

  return (
    <div
      role="tablist"
      aria-label={t(`${KEY}.label`)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      // Wrapped, the track is no longer a stadium: `rounded-full` on a two-line box turns its ends
      // into big semicircles that leave a crescent of track around the corner pills. `rounded-card`
      // is within a couple of pixels of concentric with a pill's own radius plus the 4px inset.
      className={`relative grid w-full bg-charcoal/5 p-1 sm:w-auto ${
        rows === 1 ? 'rounded-full' : 'rounded-card'
      }`}
      onKeyDown={onKeyDown}
    >
      {/* The shared selection pill: exactly ONE cell (the track minus its 8px of padding, divided by
          the columns and rows), slid by its own size per column and row. Decorative — the buttons
          carry the semantics. */}
      <span
        aria-hidden
        style={{
          width: `calc(${100 / columns}% - ${8 / columns}px)`,
          height: `calc(${100 / rows}% - ${8 / rows}px)`,
          translate: `${(index % columns) * 100}% ${Math.floor(index / columns) * 100}%`,
        }}
        className="pointer-events-none absolute left-1 top-1 rounded-full bg-white shadow-sm transition-[translate] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none"
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
