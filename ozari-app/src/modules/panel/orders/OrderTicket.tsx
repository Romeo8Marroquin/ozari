import { useTranslation } from 'react-i18next';
import { HiOutlineArrowRight } from 'react-icons/hi2';
import useBreakpoint from '@hooks/useBreakpoint';
import { formatShortDate, formatTime, isSameLocalDay } from './orderDayGroups';
import { statusTone } from './statusTone';
import useOrderLifecycle from './useOrderLifecycle';
import type { OrderAction, OrderListItem } from './order.types';

const KEY = 'modules.panel.orders.ticket';

// The card shows an order's TWO logistics events (delivery + pickup — never a history); the NEXT one
// is emphasised (label + time), the other muted, so it reads "what's next" at a glance.
const PRIMARY_LABEL = 'text-[10px] font-semibold uppercase tracking-wide text-charcoal/55';
const MUTED_LABEL = 'text-[10px] font-medium uppercase tracking-wide text-charcoal/35';
const PRIMARY_TIME = 'text-sm font-bold tabular-nums text-charcoal';
const MUTED_TIME = 'text-xs tabular-nums text-charcoal/45';

const MONEY = new Intl.NumberFormat('es-GT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * One order row of the agenda/history list — the at-a-glance ticket, in TWO layouts chosen by width
 * (`useBreakpoint`, swapped pre-paint so there's no flash and only one is ever in the DOM):
 *
 * - **≥ sm (desktop + landscape phones — enough width for the roomy disposition):** a left time rail
 *   (Entrega / Recolección, the NEXT one emphasised) beside WHO + the event/items, with the status
 *   chip and total pinned right. The original agenda look.
 * - **< sm (portrait phones):** a compact stack — a header (WHO + status) over a LABELLED logistics
 *   footer (the two events wrap, the total pinned right) — so a phone never shows the cramped `…`
 *   truncation the wide layout would force into a narrow column.
 *
 * The forward quick-action button ("Marcar En ruta" → "Marcar Entregado" → …) is the happy path made
 * one tap, and it is **entirely data-driven**: it appears exactly when the backend's lifecycle engine
 * offered this user a `forward` action on this order (so it never shows on another worker's order,
 * on a finished one, or for a role without rights), and its label is the target status' CONFIGURED
 * name — rename or add a step in "Estados del pedido" and the button follows with no code change.
 * Tapping it hands the action to `onAdvance` (the page opens `OrderAdvanceModal`, which asks for
 * photos or a reason only when that step declares it).
 *
 * User-controlled text (a client's name / an assignee) is `min-w-0` + `truncate` per the responsive
 * truncation rule so a long value can never push the page wider than a phone.
 */
const OrderTicket: React.FC<{
  order: OrderListItem;
  /** Opens the confirm dialog for the offered forward move. Absent ⇒ the button stays inert. */
  onAdvance?: (order: OrderListItem, action: OrderAction) => void;
}> = ({ order, onAdvance }) => {
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();
  // Compact (stacked) layout only on portrait phones (< sm); a landscape phone has room for the rail.
  // `isMobile` is briefly undefined pre-effect — treat that as compact; `useBreakpoint`'s layout
  // effect corrects it to the rail before paint on wider screens, so there's no visible flash.
  const compact = isMobile !== false;
  const pickup = order.pickupAt;
  const tone = statusTone(order.status.colorKey);
  const { forward } = useOrderLifecycle(order);
  // The pickup is the order's next event once it has actually been delivered (rentals); until then —
  // and for a purchase-only order — the delivery is what's next. Read from the tracked ACTUAL, not a
  // status id, so a renamed or inserted step can never mislabel the card.
  const pickupIsNext = pickup !== undefined && order.deliveredAt !== undefined;

  // The card's pieces, rendered once and placed differently per layout (only one layout mounts).
  const who = (
    <>
      <p className="truncate text-sm font-semibold text-charcoal">{order.clientName}</p>
      <p className="truncate text-xs text-charcoal/55">
        <span>
          {order.eventType.name} · {t(`${KEY}.items`, { count: order.itemCount })}
        </span>
        {/* The assignee shows only on another worker's order — MINE is conveyed by the section. */}
        {!order.isMine && (
          <span className="text-charcoal/70">
            {' · '}
            {order.assignee?.name ?? t(`${KEY}.unassigned`)}
          </span>
        )}
      </p>
    </>
  );

  const statusChip = (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      {order.status.name}
    </span>
  );

  const amount = (
    <span className="shrink-0 text-sm font-bold tabular-nums text-charcoal">
      {order.currency.symbol} {MONEY.format(order.totalAmount)}
    </span>
  );

  const deliveryEvent = (
    <div>
      <p className={pickupIsNext ? MUTED_LABEL : PRIMARY_LABEL}>{t(`${KEY}.deliveryLabel`)}</p>
      <p className={pickupIsNext ? MUTED_TIME : PRIMARY_TIME}>{formatTime(order.deliveryAt)}</p>
    </div>
  );
  const pickupEvent =
    pickup !== undefined ? (
      <div>
        <p className={pickupIsNext ? PRIMARY_LABEL : MUTED_LABEL}>{t(`${KEY}.pickupLabel`)}</p>
        <p className={pickupIsNext ? PRIMARY_TIME : MUTED_TIME}>
          {formatTime(pickup)}
          {!isSameLocalDay(order.deliveryAt, pickup) && ` · ${formatShortDate(pickup)}`}
        </p>
      </div>
    ) : (
      <p className={MUTED_LABEL}>{t(`${KEY}.purchaseOnly`)}</p>
    );

  const quickAction = forward !== undefined && (
    <div className="flex justify-end">
      <button
        type="button"
        // The whole tap: the page opens the confirm dialog for THIS offered move (which decides for
        // itself whether it needs photos or a reason). No lifecycle rule is re-derived here.
        onClick={() => onAdvance?.(order, forward)}
        aria-label={t(`${KEY}.nextStepAria`, {
          step: t(`${KEY}.nextStep`, { status: forward.statusName }),
        })}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-control bg-charcoal px-3.5 py-1.5 text-xs font-semibold text-white outline-none transition-[background-color,scale] duration-200 hover:bg-charcoal/90 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-charcoal/40 motion-reduce:transition-none"
      >
        {t(`${KEY}.nextStep`, { status: forward.statusName })}
        <HiOutlineArrowRight aria-hidden className="size-3.5" />
      </button>
    </div>
  );

  return (
    <article className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-black/[0.04]">
      {compact ? (
        <>
          {/* Header: who + what beside the status. */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">{who}</div>
            {statusChip}
          </div>
          {/* Logistics footer: the two LABELLED events wrap on a narrow phone; the total stays right. */}
          <div className="flex items-end justify-between gap-4 border-t border-black/[0.06] pt-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {deliveryEvent}
              {pickupEvent}
            </div>
            {amount}
          </div>
        </>
      ) : (
        // Roomy rail layout: times | who | status + total — the disposition wide screens have space for.
        <div className="flex items-stretch gap-5">
          <div className="flex w-28 shrink-0 flex-col justify-center gap-2 border-r border-black/[0.06] pr-4">
            {deliveryEvent}
            {pickupEvent}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">{who}</div>
          <div className="flex shrink-0 flex-col items-end justify-center gap-2">
            {statusChip}
            {amount}
          </div>
        </div>
      )}

      {quickAction}
    </article>
  );
};

export default OrderTicket;
