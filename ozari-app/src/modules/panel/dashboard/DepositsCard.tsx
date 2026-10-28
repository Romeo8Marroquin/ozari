import { useTranslation } from 'react-i18next';
import { HiChevronRight } from 'react-icons/hi2';
import { formatShortDate } from '../orders/orderDayGroups';
import type { DashboardDeposits } from './dashboard.types';
import { formatMoney } from './dashboardFormat';

const KEY = 'modules.panel.dashboard.deposits';

/** One of the month's figures — a label over an amount, both allowed to truncate in a narrow card. */
const Figure: React.FC<{ label: string; value: string; className?: string }> = ({
  label,
  value,
  className = 'text-charcoal',
}) => (
  <div className="flex min-w-0 flex-col gap-0.5 rounded-control bg-charcoal/[0.03] px-3 py-2">
    <span className="truncate text-[11px] font-medium text-charcoal/50">{label}</span>
    <span className={`truncate text-sm font-semibold tabular-nums ${className}`}>{value}</span>
  </div>
);

/**
 * The dashboard's "Depósitos" corner — the BODY of its card (the page owns the chrome and the
 * skeleton, like every other section). Deposits are rare by nature, so this sits LOW on the screen,
 * after every main figure, and stays compact:
 *
 * - **pending** — how many delivered orders still wait for their deposit's decision and how much
 *   money that is (the API counts them all), then up to five of them (the oldest deliveries) as
 *   compact links to the order, each wearing the agenda's own "Depósito pendiente" chip;
 * - **this month** — settlements first recorded this month: what went back, what was retained, what
 *   was billed for replacements, the balance still owed, and how many.
 *
 * When there is nothing on either side it collapses to ONE line — the same plain-sentence empty
 * state the ranking and the status ring use, rather than a card of zeros.
 *
 * The figures are the API's; nothing is summed here. The month grid answers to the CARD's width
 * (`@container` on the section, set by the page), never the window's.
 */
const DepositsCard: React.FC<{
  deposits: DashboardDeposits;
  currencySymbol: string;
  onOpen: (orderId: number) => void;
}> = ({ deposits, currencySymbol, onOpen }) => {
  const { t } = useTranslation();
  const money = (amount: number): string => formatMoney(currencySymbol, amount);
  const { pending, month } = deposits;

  if (pending.orders === 0 && month.settled === 0) {
    return <p className="card-item text-sm text-charcoal/45">{t(`${KEY}.empty`)}</p>;
  }

  const more = pending.orders - pending.items.length;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="card-item flex min-w-0 flex-col gap-2">
        <p className="text-sm font-medium text-charcoal">
          {pending.orders > 0
            ? t(`${KEY}.pending`, { count: pending.orders, amount: money(pending.amount) })
            : t(`${KEY}.nonePending`)}
        </p>
        {pending.items.length > 0 && (
          <ul className="flex min-w-0 flex-col gap-1">
            {pending.items.map((item) => (
              <li key={item.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  aria-label={t(`${KEY}.openAria`, { client: item.clientName })}
                  className="group flex w-full min-w-0 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-2 py-1.5 text-left outline-none transition-colors duration-200 hover:bg-charcoal/[0.04] focus-visible:ring-2 focus-visible:ring-charcoal/30"
                >
                  {/* The name gives way (truncates) first; the date + chip fold under it on a
                      narrow card instead of pushing the row wider than the card. */}
                  <span className="min-w-0 grow basis-32 truncate text-sm text-charcoal">
                    {item.clientName}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-charcoal/50">
                      {formatShortDate(item.deliveryAt)}
                    </span>
                    <span className="inline-block whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600">
                      {t(`${KEY}.chip`)}
                    </span>
                    <HiChevronRight
                      aria-hidden
                      className="size-4 text-charcoal/30 transition-colors group-hover:text-charcoal/60"
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {more > 0 && (
          <p className="px-2 text-xs text-charcoal/45">{t(`${KEY}.more`, { count: more })}</p>
        )}
      </div>

      <div className="card-item flex min-w-0 flex-col gap-2 border-t border-black/[0.06] pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal/45">
          {month.settled > 0
            ? t(`${KEY}.month`, { count: month.settled })
            : t(`${KEY}.monthNone`)}
        </p>
        {month.settled > 0 && (
          <div className="grid grid-cols-2 gap-2 @min-[34rem]:grid-cols-4">
            <Figure label={t(`${KEY}.refunded`)} value={money(month.refunded)} />
            <Figure label={t(`${KEY}.retained`)} value={money(month.retained)} />
            <Figure label={t(`${KEY}.replacements`)} value={money(month.replacements)} />
            <Figure
              label={t(`${KEY}.balanceDue`)}
              value={money(month.balanceDue)}
              className={month.balanceDue > 0 ? 'text-red-600' : 'text-charcoal'}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default DepositsCard;
