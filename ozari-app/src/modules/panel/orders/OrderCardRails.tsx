import { useTranslation } from 'react-i18next';
import { HiOutlineCheck } from 'react-icons/hi2';
import { SEGMENT_MOTION, SEGMENT_STAGGER_MS, SEGMENT_TRACK, useRetainedTotal } from './orderProgress';
import { statusFill } from './statusTone';
import type { OrderProgress } from './order.types';

/**
 * The order cards' LEFT edge: where the order stands on its own pipeline, as a segmented rail that
 * fills from the bottom — one segment per step the order walks (5 for a rental, 3 for a purchase-only
 * order, whatever the configured lifecycle says tomorrow), so "3 of 5" reads without a word.
 *
 * - The completed segments take the CURRENT status' colour — the same hue as its chip — so the rail
 *   changes colour as the order advances, and a finished order is a full bar.
 * - `overdue` turns the whole rail to warning red — but it still shows HOW FAR the order got: a late
 *   pickup on a delivered order is a mostly-full red rail, never a progress bar that forgot itself.
 * - No `progress` (cancelled, or a status outside the pipeline) leaves only the quiet track: there is
 *   no honest position to draw. An order that LOSES its progress on screen keeps its segments and
 *   drains them (`useRetainedTotal`), so cancelling is a fade, not a re-layout.
 *
 * The numbers come from the API's `progress` — the client never counts steps itself (it doesn't know
 * the order's mode, and a count kept here would drift the day a step is added).
 *
 * Decorative (`aria-hidden`): the status chip already NAMES the step in words, and the countdown says
 * "Atrasado" — colour is never the only carrier of either fact. The host card must be `relative`
 * and `overflow-hidden` (its rounded corners clip the rail's ends) and leave room for it on the left.
 */
export const OrderProgressRail: React.FC<{
  progress?: OrderProgress;
  colorKey?: string;
  overdue?: boolean;
}> = ({ progress, colorKey, overdue = false }) => {
  const fill = overdue ? 'bg-red-500' : statusFill(colorKey);
  const track = overdue ? 'bg-red-100' : SEGMENT_TRACK;
  const segments = useRetainedTotal(progress) ?? 1;
  const reached = progress?.step ?? 0;

  return (
    <span
      aria-hidden
      data-testid="order-progress-rail"
      data-overdue={overdue}
      className="absolute inset-y-0 left-0 flex w-1.5 flex-col-reverse gap-0.5"
    >
      {Array.from({ length: segments }, (_, index) => (
        <span
          // A segment IS its position on the pipeline — the index is its identity here.
          key={index}
          data-filled={index < reached}
          className={`min-h-0 flex-1 ${SEGMENT_MOTION} ${index < reached ? fill : track}`}
          style={{ transitionDelay: `${index * SEGMENT_STAGGER_MS}ms` }}
        />
      ))}
    </span>
  );
};

/**
 * The order cards' RIGHT edge: a thin emerald seam once the money is in — a quiet "this one is paid"
 * you can pick out while scanning a column of cards, without competing with the progress rail or the
 * status chip. Unpaid orders show nothing here (not a warning colour: an unpaid order is normal, and
 * its "Registrar pago" button already says so).
 *
 * It stays MOUNTED and fades (opacity is a binary UI state → a CSS transition), so recording or
 * undoing a payment from the card is a soft arrival or departure rather than a pop. Decorative, like
 * the rail: the payment button's presence/absence carries the same fact for assistive tech. Sits
 * inside the card's right padding, so it never overlaps the chip or the actions.
 */
export const OrderPaidEdge: React.FC<{ isPaid: boolean }> = ({ isPaid }) => (
  <span
    aria-hidden
    data-testid="order-paid-edge"
    data-paid={isPaid}
    className={`pointer-events-none absolute inset-y-0 right-0 w-[3px] bg-gradient-to-b from-emerald-300 via-emerald-400 to-emerald-300 shadow-[-2px_0_10px_rgba(52,211,153,0.35)] transition-opacity duration-500 ease-[var(--ease-settle)] motion-reduce:transition-none ${
      isPaid ? 'opacity-100' : 'opacity-0'
    }`}
  />
);

/**
 * The detail page's word for the same fact the seam states on the cards: a quiet emerald "Pagado"
 * chip beside the status chip, absent while unpaid (an unpaid order is normal — "Registrar pago"
 * already says so).
 *
 * ALWAYS MOUNTED: it eases its own column open/shut (`grid-cols 0fr↔1fr`, the app's horizontal
 * collapse — see `LocationField`) while it fades, so recording or undoing a payment slides the chip
 * in or out and the status chip beside it glides over, instead of a chip popping into the header.
 * Hidden, it is `aria-hidden` — nothing is announced that isn't shown. Its leading gap lives INSIDE
 * the collapsing column, so a closed chip leaves no stray space behind.
 */
export const OrderPaidChip: React.FC<{ isPaid: boolean }> = ({ isPaid }) => {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden={!isPaid}
      data-testid="order-paid-chip"
      data-paid={isPaid}
      className={`grid transition-[grid-template-columns,opacity] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
        isPaid ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0'
      }`}
    >
      <span className="min-w-0 overflow-hidden">
        <span className="ml-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600">
          <HiOutlineCheck aria-hidden className="size-3" />
          {t('modules.panel.orders.detail.paid')}
        </span>
      </span>
    </span>
  );
};
