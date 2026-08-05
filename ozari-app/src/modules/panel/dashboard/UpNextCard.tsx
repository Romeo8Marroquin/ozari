import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowRight,
  HiOutlineBanknotes,
  HiOutlineClock,
  HiOutlineMapPin,
} from 'react-icons/hi2';
import Button from '@components/Button';
import MorphSwap from '@components/MorphSwap';
import OpenInMapsButton from '@components/OpenInMapsButton';
import { orderDestination } from '@utils/mapLinks';
import { formatShortDate, formatTime, isSameLocalDay } from '../orders/orderDayGroups';
import { statusTone } from '../orders/statusTone';
import useOrderLifecycle from '../orders/useOrderLifecycle';
import type { OrderAction } from '../orders/order.types';
import type { UpNextItem } from './dashboard.types';
import { relativeKey, relativeTime } from './dashboardFormat';

const KEY = 'modules.panel.dashboard.upNext';
const SECONDARY_COLOR = '#262626';

/**
 * One slot of the "what's next" queue.
 *
 * The card is about ONE event — the single thing this order still owes — so it leads with the
 * countdown to that event, not with the order's whole schedule. That is the difference between this
 * screen and the agenda: the agenda answers "what does my week look like", this answers "what do I
 * do now".
 *
 * Everything actionable is data-driven exactly as on a ticket: the forward step comes from the
 * backend's lifecycle engine (`useOrderLifecycle`), and the navigation button appears only when
 * there is somewhere to go (`orderDestination` resolves pin-or-address and returns nothing when
 * there is neither — a maps app opened on an empty search helps no one).
 */
const UpNextCard: React.FC<{
  item: UpNextItem;
  /** `0` is the one being acted on now — it gets the emphasis. */
  rank: number;
  onOpen: (item: UpNextItem) => void;
  onAdvance: (item: UpNextItem, action: OrderAction) => void;
  /** Opens the payment dialog. Offered only while the order is unpaid. */
  onPay: (item: UpNextItem) => void;
}> = ({ item, rank, onOpen, onAdvance, onPay }) => {
  const { t } = useTranslation();
  const { forward } = useOrderLifecycle(item);
  const lead = rank === 0;
  const destination = orderDestination(item.deliveryAddress, item.deliveryCoords);
  const eventLabel = t(`${KEY}.kind.${item.event.kind}`);

  // ONE key + ONE number, in whichever unit actually reads as a sentence — the same ladder in both
  // directions, so "en 3 horas" and "atrasado 3 horas" can never disagree about their thresholds.
  const relative = relativeTime(item.event.minutesUntil);
  const countdownLabel = t(`${KEY}.${relativeKey(relative)}`, { count: relative.value });

  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={t(`${KEY}.openAria`, { client: item.clientName })}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(item);
        }
      }}
      // The lead card is visually louder (a solid charcoal accent bar, a heavier surface) and the
      // other two recede — the ranking has to be legible without reading a single word, because the
      // whole point of the queue is glanceability. Same hover grammar as the agenda ticket.
      className={`group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-card bg-white p-4 outline-none transition-[translate,box-shadow] duration-300 ease-[var(--ease-settle)] hover:-translate-y-0.5 hover:shadow-[0_14px_34px_-20px_rgba(38,38,38,0.5)] hover:duration-150 hover:ease-[cubic-bezier(0.2,0,0,1)] active:translate-y-0 active:duration-75 focus-visible:ring-2 focus-visible:ring-charcoal/30 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        lead
          ? 'ring-1 ring-black/[0.08] shadow-[0_10px_30px_-24px_rgba(38,38,38,0.5)]'
          : 'ring-1 ring-black/[0.04]'
      }`}
    >
      {/* The urgency rail: red once the event is late, brand gradient for the one in hand, quiet
          otherwise. Colour is the ONLY thing that says "overdue" twice — the copy says it too. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1.5 ${
          item.event.isOverdue
            ? 'bg-red-500'
            : lead
              ? 'bg-gradient-to-b from-cream to-blossom'
              : 'bg-charcoal/10'
        }`}
      />

      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-charcoal/45">
            {eventLabel}
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {formatTime(item.event.at)}
              {!isSameLocalDay(item.deliveryAt, item.event.at) &&
                ` · ${formatShortDate(item.event.at)}`}
            </span>
          </p>
          <p
            className={`mt-0.5 truncate font-semibold text-charcoal ${lead ? 'text-base' : 'text-sm'}`}
          >
            {item.clientName}
          </p>
          <p className="mt-0.5 truncate text-xs text-charcoal/55">
            {item.eventType.name} · {t(`${KEY}.items`, { count: item.itemCount })}
          </p>
        </div>
        <span
          className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-[background-color,color] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${statusTone(item.status.colorKey)}`}
        >
          <MorphSwap swapKey={item.status.id}>{item.status.name}</MorphSwap>
        </span>
      </div>

      <p className="flex min-w-0 items-start gap-1.5 pl-2 text-xs text-charcoal/55">
        <HiOutlineMapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.deliveryAddress}</span>
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pl-2 pt-3">
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums ${
            item.event.isOverdue ? 'text-red-600' : 'text-charcoal/70'
          }`}
        >
          <HiOutlineClock aria-hidden className="size-3.5" />
          {countdownLabel}
        </span>

        <div
          className="flex shrink-0 items-center gap-2"
          // The row holds the two ESCAPES from this card (navigate away, advance the order); neither
          // should also open the detail behind them.
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          {/* Both actions are the SAME component at the SAME size — the only way two buttons in a
              row are guaranteed to share a height. `xs` is the deliberate summary size: shorter than
              a page action, identical to its neighbour. */}
          {destination && <OpenInMapsButton destination={destination} size="xs" iconOnly />}
          {/* Money is its own axis, so it gets its own affordance — but ICON-ONLY here: a scannable
              card has room for one full label, and that belongs to the step that moves the job
              forward. The full "Registrar pago" wording lives on the order detail. */}
          {!item.isPaid && (
            <Button
              size="xs"
              variant="soft"
              color={SECONDARY_COLOR}
              onClick={() => onPay(item)}
              aria-label={t(`${KEY}.payAria`, { client: item.clientName })}
              title={t(`${KEY}.pay`)}
              startIcon={<HiOutlineBanknotes aria-hidden className="size-4" />}
            />
          )}
          {forward && (
            <Button
              size="xs"
              color={SECONDARY_COLOR}
              onClick={() => onAdvance(item, forward)}
              aria-label={t(`${KEY}.nextStepAria`, {
                step: t(`${KEY}.nextStep`, { status: forward.statusName }),
              })}
              endIcon={<HiOutlineArrowRight aria-hidden className="size-3.5" />}
              className="font-semibold"
            >
              <MorphSwap swapKey={forward.statusId}>
                {t(`${KEY}.nextStep`, { status: forward.statusName })}
              </MorphSwap>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
};

export default UpNextCard;
