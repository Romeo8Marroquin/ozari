import { useTranslation } from 'react-i18next';
import { formatShortDate, formatTime, isSameLocalDay } from './orderDayGroups';
import type { OrderListItem } from './order.types';

const KEY = 'modules.panel.orders.ticket';

/**
 * Status-chip tones by seeded `service_status` id (Pendiente / Cancelado / Entregado /
 * Recolectado / En ruta). Any unknown status falls back to the neutral tone — the chip must never
 * break when a new status is seeded before the frontend learns its color.
 */
const STATUS_TONES: Record<number, string> = {
  1: 'bg-amber-50 text-amber-600',
  2: 'bg-red-50 text-red-500',
  3: 'bg-emerald-50 text-emerald-600',
  4: 'bg-sky-50 text-sky-600',
  5: 'bg-indigo-50 text-indigo-600',
};
const DEFAULT_TONE = 'bg-charcoal/5 text-charcoal/60';

const MONEY = new Intl.NumberFormat('es-GT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * One order row of the agenda/history list — the at-a-glance ticket: the logistics times on a
 * left rail (delivery big, pickup under it; a purchase-only order says "Solo entrega" instead),
 * who + what kind of event + how many items in the middle, and the status chip + total on the
 * right. Deliberately **not interactive yet** — it becomes the link into the order detail when
 * that page lands (a fake button that goes nowhere would be worse a11y than none).
 *
 * The middle column is the user-controlled text (a client's name) — `min-w-0` + `truncate` per
 * the responsive truncation rule so a long name can never push the page wider than a phone.
 */
const OrderTicket: React.FC<{ order: OrderListItem }> = ({ order }) => {
  const { t } = useTranslation();
  const pickup = order.pickupAt;
  const tone = STATUS_TONES[order.status.id] ?? DEFAULT_TONE;

  return (
    <article className="flex items-center gap-4 rounded-card bg-white p-4 ring-1 ring-black/[0.04]">
      {/* Narrower rail on phones: at ~320px the middle column must keep room to truncate. */}
      <div className="flex w-20 shrink-0 flex-col items-center gap-0.5 border-r border-black/[0.06] pr-3 text-center sm:w-24 sm:pr-4">
        <span className="text-sm font-bold tabular-nums text-charcoal">
          {formatTime(order.deliveryAt)}
        </span>
        {pickup !== undefined ? (
          <span className="text-[11px] tabular-nums text-charcoal/45">
            {`→ ${formatTime(pickup)}`}
            {!isSameLocalDay(order.deliveryAt, pickup) && ` · ${formatShortDate(pickup)}`}
          </span>
        ) : (
          <span className="text-[11px] text-charcoal/45">{t(`${KEY}.purchaseOnly`)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-charcoal">{order.clientName}</p>
        <p className="truncate text-xs text-charcoal/55">
          {order.eventType.name} · {t(`${KEY}.items`, { count: order.itemCount })}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>
          {order.status.name}
        </span>
        <span className="text-sm font-bold tabular-nums text-charcoal">
          {order.currency.symbol} {MONEY.format(order.totalAmount)}
        </span>
      </div>
    </article>
  );
};

export default OrderTicket;
