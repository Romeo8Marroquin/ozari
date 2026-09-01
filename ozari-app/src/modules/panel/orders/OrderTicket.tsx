import { useTranslation } from 'react-i18next';
import { HiOutlineArrowRight, HiOutlineBanknotes } from 'react-icons/hi2';
import Button from '@components/Button';
import MorphSwap from '@components/MorphSwap';
import OpenInMapsButton from '@components/OpenInMapsButton';
import { orderDestination } from '@utils/mapLinks';
import useBreakpoint from '@hooks/useBreakpoint';
import ActionRow from '../ActionRow';
import { formatShortDate, formatTime, isSameLocalDay } from './orderDayGroups';
import { statusTone } from './statusTone';
import useOrderLifecycle, { isTravelStep } from './useOrderLifecycle';
import type { OrderAction, OrderListItem } from './order.types';

const KEY = 'modules.panel.orders.ticket';
const SECONDARY_COLOR = '#262626';

// The card shows an order's TWO logistics events (delivery + pickup — never a history); the NEXT one
// is emphasised (label + time), the other muted, so it reads "what's next" at a glance.
//
// Emphasis MOVES as the order advances (delivery → pickup → neither), and it moved abruptly: three
// properties flipped in one frame. They're now transitioned on the SAME element — the node persists
// across renders, so the browser interpolates them:
//   · `font-size`  — the big one. Because it animates continuously the text REFLOWS every frame, so
//     the rail's width and the row's height follow the emphasis smoothly instead of snapping to it
//     (which is what "take the little extra space it needs, smoothly" actually requires).
//   · `color`      — always interpolable.
//   · `font-weight`— interpolates on the variable system UI fonts (Segoe UI Variable, SF Pro); where
//     it can't, it lands during a size+colour morph that's already in motion, so it reads as part of
//     the same gesture rather than a jolt.
const EMPHASIS_MOTION =
  'transition-[font-size,font-weight,color] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none';
const LABEL_BASE = `text-[10px] uppercase tracking-wide ${EMPHASIS_MOTION}`;
const TIME_BASE = `tabular-nums ${EMPHASIS_MOTION}`;
const PRIMARY_LABEL = `${LABEL_BASE} font-semibold text-charcoal/55`;
const MUTED_LABEL = `${LABEL_BASE} font-medium text-charcoal/35`;
const PRIMARY_TIME = `${TIME_BASE} text-sm font-bold text-charcoal`;
// The muted weight is stated explicitly (not inherited) so the transition has two real endpoints.
const MUTED_TIME = `${TIME_BASE} text-xs font-normal text-charcoal/45`;

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
 * one tap. It is **entirely data-driven**: it appears when the backend's lifecycle engine offered
 * this user a `forward` move (never on a finished/cancelled order, nor for a role without rights),
 * and its label is the target status' CONFIGURED name — rename or insert a step and the button
 * follows with no code change. It is additionally scoped to the viewer's **own** orders: rewinding
 * and cancelling are offered to an Admin on every order, but they belong to the order DETAIL, not to
 * a list you scan. Tapping it hands the action to `onAdvance` (the page opens `OrderAdvanceModal`,
 * which asks for photos or a reason only when that step declares it).
 *
 * User-controlled text (a client's name / an assignee) is `min-w-0` + `truncate` per the responsive
 * truncation rule so a long value can never push the page wider than a phone.
 */
const OrderTicket: React.FC<{
  order: OrderListItem;
  /** Opens the order's detail page (the whole card is the affordance). */
  onOpen?: (order: OrderListItem) => void;
  /** Opens the confirm dialog for the offered forward move. Absent ⇒ the button stays inert. */
  onAdvance?: (order: OrderListItem, action: OrderAction) => void;
  /** Opens the payment dialog. Absent ⇒ the action isn't offered at all (a Driver's agenda: money
   *  is the admin's, a driver reports what happened physically). */
  onPay?: (order: OrderListItem) => void;
}> = ({ order, onOpen, onAdvance, onPay }) => {
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();
  // Compact (stacked) layout only on portrait phones (< sm); a landscape phone has room for the rail.
  // `isMobile` is briefly undefined pre-effect — treat that as compact; `useBreakpoint`'s layout
  // effect corrects it to the rail before paint on wider screens, so there's no visible flash.
  const compact = isMobile !== false;
  const pickup = order.pickupAt;
  const { forward } = useOrderLifecycle(order);

  // As an order advances, the two pieces that CARRY its state rewrite themselves — the status chip
  // and the next-step button — and both change WORD and WIDTH at once. `MorphSwap` makes that a
  // single continuous gesture (the box adapts to the new size while the labels cross-fade through
  // each other) instead of a swap. Keyed by ID so a background refetch of an unchanged order
  // animates nothing. Everything else on the card — times, total, position in the agenda — updates
  // immediately: those are the facts the list is ORDERED by.
  const tone = statusTone(order.status.colorKey);

  // Emphasis means exactly ONE thing: "this is the event you still have to do". It is NOT "this is a
  // date" — so an event that already happened, and every event on a finished or cancelled order, is
  // muted. Derived from the tracked ACTUALS (a renamed or inserted status can never mislabel it):
  //   · nothing delivered yet            → the DELIVERY is what's next;
  //   · delivered, pickup still pending  → the PICKUP is what's next;
  //   · collected / finished / cancelled → nothing is pending, so nothing is emphasised.
  const settled = order.readyAt !== undefined || order.cancelledAt !== undefined;
  const destination = orderDestination(undefined, order.deliveryCoords);
  const deliveryIsNext = !settled && order.deliveredAt === undefined;
  const pickupIsNext =
    !settled &&
    pickup !== undefined &&
    order.deliveredAt !== undefined &&
    order.collectedAt === undefined;

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
    // The pill sizes itself to the morphing label inside it (so it grows/shrinks with the word), and
    // its TINT morphs natively — a CSS transition retargets mid-flight, keeping colour and text in
    // step through even a rapid Pendiente → En ruta → Entregado run.
    <span
      className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-[background-color,color] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${tone}`}
    >
      <MorphSwap swapKey={order.status.id}>{order.status.name}</MorphSwap>
    </span>
  );

  const amount = (
    <span className="shrink-0 text-sm font-bold tabular-nums text-charcoal">
      {order.currency.symbol} {MONEY.format(order.totalAmount)}
    </span>
  );

  const deliveryEvent = (
    <div>
      <p className={deliveryIsNext ? PRIMARY_LABEL : MUTED_LABEL}>{t(`${KEY}.deliveryLabel`)}</p>
      <p className={deliveryIsNext ? PRIMARY_TIME : MUTED_TIME}>{formatTime(order.deliveryAt)}</p>
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

  // The list carries EXACTLY ONE action: the forward step, on the viewer's OWN orders. The backend
  // offers an Admin the full set on every order (advance, rewind, cancel) — but a scanning agenda is
  // not where you rewind or cancel someone's order; those belong to the order DETAIL (owner decision
  // 2026-07-27). So the ticket deliberately narrows the offer to `isMine` + `forward`.
  // Both actions are the SAME component at the SAME size — the only way two buttons in a row are
  // guaranteed to share a height. `xs` is the deliberate SUMMARY size: shorter than a page action,
  // identical to its neighbour. `stopPropagation` keeps either from ALSO opening the detail behind.
  const quickAction = order.isMine && forward !== undefined && (
    <Button
      size="xs"
      color={SECONDARY_COLOR}
      onClick={(event) => {
        event.stopPropagation();
        onAdvance?.(order, forward);
      }}
      aria-label={t(`${KEY}.nextStepAria`, {
        step: t(`${KEY}.nextStep`, { status: forward.statusName }),
      })}
      endIcon={<HiOutlineArrowRight aria-hidden className="size-3.5" />}
      className="font-semibold"
    >
      {/* The button sizes itself to the morphing label, so it widens/narrows with the next step's
          name instead of snapping between two widths. */}
      <MorphSwap swapKey={forward.statusId}>
        {t(`${KEY}.nextStep`, { status: forward.statusName })}
      </MorphSwap>
    </Button>
  );

  // Money is its OWN axis, not a lifecycle step — so it gets its own affordance, ICON-ONLY on a
  // scannable row where the one full label belongs to the step that moves the job forward. Offered
  // on any unpaid order (not just `isMine`): collecting is the admin's job wherever they see it.
  const payAction = onPay !== undefined && !order.isPaid && (
    <Button
      size="xs"
      variant="soft"
      color={SECONDARY_COLOR}
      onClick={(event) => {
        event.stopPropagation();
        onPay(order);
      }}
      aria-label={t(`${KEY}.payAria`, { client: order.clientName })}
      title={t(`${KEY}.pay`)}
      startIcon={<HiOutlineBanknotes aria-hidden className="size-4" />}
    />
  );

  // Navigation, offered on exactly the same rule as everywhere else: the order has a PIN and the
  // move it is waiting for is somebody DRIVING (`isTravelStep`) — not merely "it is unfinished",
  // which put a Waze button on orders scheduled for next week. Icon-only for the same reason the
  // payment action is: a scannable row has room for one full label, and it belongs to the step that
  // moves the job forward.
  const mapsAction = destination && isTravelStep(forward) && (
    <span
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="presentation"
    >
      <OpenInMapsButton destination={destination} size="xs" iconOnly />
    </span>
  );

  // The row is DERIVED from the order's state, so its membership changes under the reader: taking a
  // payment removes the middle button, going en route adds the first. `ActionRow` makes that a
  // gesture — the leaving button fades where it stands, then the rest glide into the space — instead
  // of a one-frame re-layout. The keys are the actions' identities, never their positions.
  const actionItems = [
    ...(mapsAction ? [{ key: 'maps', node: mapsAction }] : []),
    ...(payAction ? [{ key: 'pay', node: payAction }] : []),
    ...(quickAction ? [{ key: 'advance', node: quickAction }] : []),
  ];

  return (
    <article
      // The whole card opens the order. It's a real <article> with an inner button rather than a
      // <button> wrapper: the quick action lives INSIDE it, and nesting interactive elements is
      // invalid — so the card takes the click/keys itself and the action stops propagation.
      role="link"
      tabIndex={0}
      aria-label={t(`${KEY}.openAria`, { client: order.clientName })}
      onClick={() => onOpen?.(order)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen?.(order);
        }
      }}
      // Hover with restraint: the card LIFTS a hair and its ring warms — no scale (a list of cards
      // that grow reads as jitter), no shadow bloom. Three things make it read as electric rather
      // than abrupt:
      //
      //  · **Only two properties are transitioned.** `--tw-ring-color` used to be in the list, and
      //    that was the jolt: a custom property registered `syntax: "*"` is NOT interpolable, so it
      //    flipped DISCRETELY halfway through — and because `box-shadow` (which is what a Tailwind
      //    v4 ring actually is) resolves that variable, the flip restarted the shadow's own
      //    transition mid-flight. One `box-shadow` entry animates the ring AND the shadow together,
      //    smoothly, because they are literally the same property.
      //  · **Asymmetric timing**, the app's fast-out/slow-in rule applied to a pointer: entering is
      //    quick and decisive (150ms, a snappy decelerate), leaving settles back over 300ms on the
      //    shared `--ease-settle`. One duration in both directions is what makes a hover feel
      //    either sluggish on the way in or clipped on the way out.
      //  · **2px, not 1.** A single pixel is below what the eye can follow through an ease, so the
      //    old lift arrived before it could be seen as motion. `translate` is transitioned BY NAME
      //    because Tailwind v4 emits it as an independent property (`transition-transform` misses).
      //
      // Pressing releases the lift instantly (75ms) — the tactile "it took the tap" that a list of
      // tappable rows needs on touch, where there is no hover to speak of.
      className="flex cursor-pointer flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-black/[0.04] outline-none transition-[translate,box-shadow] duration-300 ease-[var(--ease-settle)] hover:-translate-y-0.5 hover:shadow-[0_14px_34px_-20px_rgba(38,38,38,0.5)] hover:ring-black/[0.10] hover:duration-150 hover:ease-[cubic-bezier(0.2,0,0,1)] active:translate-y-0 active:shadow-[0_4px_14px_-10px_rgba(38,38,38,0.45)] active:duration-75 focus-visible:ring-2 focus-visible:ring-charcoal/30 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
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
          {/* On a phone the action earns its own full row — it's the primary tap, thumb-reachable.
              `ActionRow` IS that row (it renders nothing when there is no action to offer), so the
              card's gap closes by itself once the last one is gone. */}
          <ActionRow items={actionItems} className="flex items-center justify-end gap-2" />
        </>
      ) : (
        // Roomy rail layout: times | who | status + total + action. The action lives INSIDE the right
        // column rather than on a row of its own: a wide card already has empty space there, and a
        // full-width strip under the card just to hold one small button reads as a hole (owner,
        // 2026-07-27). Stacking it under the total also keeps the card's height identical whether or
        // not the action is offered — rows don't jump as orders advance.
        <div className="flex items-stretch gap-5">
          {/* The time rail sizes to its CONTENT (`shrink-0` + `whitespace-nowrap`), never to a fixed
              width: a pickup on another day reads "1:57 p. m. · 29 jul", which a 7rem column wrapped
              onto two lines while the middle column sat half empty. The client/event column is
              `flex-1 min-w-0`, so it yields the space and truncates instead. */}
          <div className="flex shrink-0 flex-col justify-center gap-2 whitespace-nowrap border-r border-black/[0.06] pr-4">
            {deliveryEvent}
            {pickupEvent}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">{who}</div>
          <div className="flex shrink-0 flex-col items-end justify-center gap-2">
            {statusChip}
            {amount}
            <ActionRow items={actionItems} className="flex items-center gap-2" />
          </div>
        </div>
      )}
    </article>
  );
};

export default OrderTicket;

