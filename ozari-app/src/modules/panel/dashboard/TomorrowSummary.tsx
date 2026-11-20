import { useTranslation } from 'react-i18next';
import { HiOutlineTruck } from 'react-icons/hi2';
import type { Dashboard } from './dashboard.types';
import { formatBusinessDay } from './dashboardFormat';

const KEY = 'modules.panel.dashboard.tomorrow';

/**
 * "Entregas de mañana" — ONE number, never cards: how many orders go OUT tomorrow (owner,
 * 2026-11-19/20). Collections are deliberately not counted — the day ahead is planned around the
 * deliveries — so an order only coming back tomorrow is absent, and one delivering tomorrow counts
 * whenever it comes back. It sits under today's queue: the front door answers "what now" with cards
 * and "what goes out next" with one line.
 *
 * The figure is the API's (`tomorrow.deliveries`). The day is named from the API's own period in the
 * business's zone, so an admin abroad still reads Guatemala's tomorrow. A day with nothing to deliver
 * says so in words rather than printing a zero.
 */
const TomorrowSummary: React.FC<{ tomorrow: Dashboard['tomorrow'] }> = ({ tomorrow }) => {
  const { t } = useTranslation();
  const { deliveries } = tomorrow;

  return (
    <section
      aria-label={t(`${KEY}.title`)}
      className="card-item flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-white px-4 py-3 ring-1 ring-black/[0.04]"
    >
      {/* The label is what gives way when the row folds — the figure stays whole. */}
      <div className="flex min-w-0 grow basis-40 items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-chip bg-charcoal/[0.05] text-charcoal/60">
          <HiOutlineTruck aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-charcoal">{t(`${KEY}.title`)}</p>
          <p className="truncate text-[11px] text-charcoal/45 first-letter:uppercase">
            {formatBusinessDay(tomorrow.period.from)}
          </p>
        </div>
      </div>

      {deliveries === 0 ? (
        <p className="text-xs text-charcoal/50">{t(`${KEY}.none`)}</p>
      ) : (
        <p className="text-base font-bold tabular-nums text-charcoal">
          {t(`${KEY}.orders`, { count: deliveries })}
        </p>
      )}
    </section>
  );
};

export default TomorrowSummary;
