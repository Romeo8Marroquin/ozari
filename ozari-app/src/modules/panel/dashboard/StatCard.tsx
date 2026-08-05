import { useTranslation } from 'react-i18next';
import { HiOutlineArrowTrendingDown, HiOutlineArrowTrendingUp, HiOutlineMinus } from 'react-icons/hi2';
import type { IconType } from 'react-icons';
import type { StatComparison } from './dashboard.types';
import { deltaTone } from './dashboardFormat';

const KEY = 'modules.panel.dashboard.stats';

const TONE_CLASS = {
  up: 'text-emerald-600 bg-emerald-50',
  down: 'text-red-600 bg-red-50',
  flat: 'text-charcoal/50 bg-charcoal/[0.05]',
  none: 'text-charcoal/40 bg-charcoal/[0.04]',
} as const;

const TONE_ICON: Record<keyof typeof TONE_CLASS, IconType> = {
  up: HiOutlineArrowTrendingUp,
  down: HiOutlineArrowTrendingDown,
  flat: HiOutlineMinus,
  none: HiOutlineMinus,
};

/**
 * One headline figure with its month-over-month direction.
 *
 * **A trend badge is only rendered when there is something to compare against.** When the previous
 * period was zero the backend omits `deltaPercent` entirely and this shows "sin comparación" — a
 * "+100%" on a month that started from nothing is the kind of number that quietly teaches an owner
 * to distrust the whole screen.
 *
 * A DOWN month is not automatically bad (fewer, larger orders is a good month), so the badge states
 * the direction in the app's own restraint rather than shouting in red across the card.
 */
const StatCard: React.FC<{
  label: string;
  value: string;
  icon: IconType;
  /** Absent ⇒ a plain figure with no badge (the counters that have no previous period). */
  stat?: StatComparison;
  /** Small print under the value — the raw previous figure, a count, a hint. */
  hint?: string;
}> = ({ label, value, icon: Icon, stat, hint }) => {
  const { t } = useTranslation();
  const tone = stat ? deltaTone(stat) : undefined;
  const ToneIcon = tone ? TONE_ICON[tone] : undefined;
  // Built here, from the ONE value that decides it, so the badge can never be asked to render a
  // percentage that isn't there.
  const badgeLabel =
    stat === undefined
      ? undefined
      : stat.deltaPercent === undefined
        ? t(`${KEY}.noComparison`)
        : t(`${KEY}.delta`, { value: Math.abs(stat.deltaPercent) });

  return (
    <div className="reveal-item flex min-w-0 flex-col gap-2 rounded-card bg-white p-4 ring-1 ring-black/[0.04]">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-chip bg-charcoal/[0.05] text-charcoal/60">
          <Icon aria-hidden className="size-4" />
        </span>
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-charcoal/55">{label}</p>
      </div>

      <p className="truncate text-xl font-bold tabular-nums text-charcoal sm:text-2xl">{value}</p>

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {tone && ToneIcon && (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-chip px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${TONE_CLASS[tone]}`}
          >
            <ToneIcon aria-hidden className="size-3" />
            {badgeLabel}
          </span>
        )}
        {hint && <span className="min-w-0 truncate text-[11px] text-charcoal/45">{hint}</span>}
      </div>
    </div>
  );
};

export default StatCard;
