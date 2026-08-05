import { useParams } from '@tanstack/react-router';
import type { AxiosError } from 'axios';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowLeft,
  HiOutlineArrowPath,
  HiOutlineArrowUturnLeft,
  HiOutlineArrowRight,
  HiOutlinePencilSquare,
  HiOutlineBanknotes,
  HiOutlineTrash,
  HiOutlineXMark,
} from 'react-icons/hi2';
import Button from '@components/Button';
import ImageLightbox from '@components/ImageLightbox';
import MorphSwap from '@components/MorphSwap';
import OpenInMapsButton from '@components/OpenInMapsButton';
import { orderDestination } from '@utils/mapLinks';
import { Role } from '@constants/Roles';
import { useHasRole } from '@hooks/useRole';
import { getStatus } from '@utils/apiError';
import { growCardIn, SECTION_REVEAL_STEP, staggerIn, staggerOut } from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import useMorphOnChange from '../useMorphOnChange';
import ProductsStatus from '../products/ProductsStatus';
import SectionReveal from '../products/SectionReveal';
import { formatTime } from './orderDayGroups';
import OrderAdvanceModal from './OrderAdvanceModal';
import OrderDeleteModal from './OrderDeleteModal';
import OrderPaymentModal from './OrderPaymentModal';
import OrderStatusModal from './OrderStatusModal';
import { statusTone } from './statusTone';
import { useOrder } from './useOrder';
import { useOrdersCatalog } from './useOrdersCatalog';
import type { OrderAction, OrderEvidence } from './order.types';

const KEY = 'modules.panel.orders.detail';
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';
/** The column's `gap-4`, in px — what a card joining it has to swallow while it grows open. */
const COLUMN_GAP = 16;

const MONEY = new Intl.NumberFormat('es-GT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `Q 1,250.00` — the currency is the order's own, so the symbol travels with every amount. */
const money = (symbol: string, value: number): string => `${symbol} ${MONEY.format(value)}`;

/** `viernes 1 de agosto, 2:00 p. m.` — the detail has room to spell a moment out in full. */
const formatMoment = (iso: string): string => {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('es-GT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  return `${day.charAt(0).toUpperCase()}${day.slice(1)}, ${formatTime(iso)}`;
};

/** One labelled fact. `value` absent ⇒ the row isn't rendered at all (never an empty label).
 *  Carries its label as a FLIP identity so a fact that appears when the order advances (the
 *  "Entregado el" moment) rises in while the ones already there glide to their new places. */
const Fact: React.FC<{ label: string; value?: string | number | null }> = ({ label, value }) =>
  value === undefined || value === null || value === '' ? null : (
    <div data-flip-id={label} className="card-item fact-flip min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-charcoal/40">{label}</p>
      <p className="mt-0.5 break-words text-sm text-charcoal">{value}</p>
    </div>
  );

/** A shimmering line of `w` (a Tailwind width class) — the skeleton's only primitive. */
const Bar: React.FC<{ w: string; h?: string }> = ({ w, h = 'h-3.5' }) => (
  <span className={`block ${h} ${w} animate-pulse rounded-chip bg-charcoal/[0.07]`} />
);

/** A card's placeholder BODY — the same title row + content shape the real body will have, so the
 *  card's height barely has to travel. The title is a bar too: a crisp heading over a shimmering
 *  body reads as half-broken rather than as loading. */
const SkeletonBody: React.FC<{
  titleWidth: string;
  aside?: boolean;
  children: React.ReactNode;
}> = ({ titleWidth, aside = false, children }) => (
  <div className="flex flex-col gap-4" aria-hidden>
    <div className="flex items-center justify-between gap-3">
      <Bar w={titleWidth} />
      {aside && <Bar w="w-20" h="h-5" />}
    </div>
    {children}
  </div>
);

/** Shimmering facts in the shape the real grids use. */
const SkeletonFacts: React.FC<{ rows?: number }> = ({ rows = 2 }) => (
  <div className="grid gap-4 sm:grid-cols-2">
    {Array.from({ length: rows * 2 }).map((_, index) => (
      <div key={index} className="flex flex-col gap-1.5">
        <Bar w="w-24" h="h-2.5" />
        <Bar w={index % 2 === 0 ? 'w-40' : 'w-32'} />
      </div>
    ))}
  </div>
);

/**
 * ONE card of the page — and, on a cold load, the thing that TRANSFORMS into its loaded self.
 *
 * The card SURFACE is never re-created: it is painted from the first frame and stays. Only its
 * inside changes, through `SectionReveal`: the shimmer dissolves while the card's height eases from
 * the placeholder's to the content's and the real fields (`.card-item`) wave in. So the column reads
 * as a set of cards growing and settling into their information — not as one screen being swapped
 * for another. Sibling cards cascade via `step` (the products-form doctrine, applied to a detail).
 *
 * `.card-item` is deliberately NOT `.reveal-item`: the latter is the PAGE's vocabulary (the cards
 * themselves ride the panel's enter/exit sweep as wholes), and letting the two overlap would make a
 * page transition animate every field individually.
 */
const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
  loading?: boolean;
  /** This card's slot in the load cascade. */
  step?: number;
  skeleton?: React.ReactNode;
}> = ({ title, children, aside, loading = false, step = 0, skeleton }) => (
  <section className="reveal-item flex flex-col rounded-card bg-white p-5 ring-1 ring-black/[0.04]">
    <SectionReveal
      loading={loading}
      delaySeconds={step * SECTION_REVEAL_STEP}
      itemSelector=".card-item"
      skeleton={skeleton}
    >
      <div className="flex flex-col gap-4">
        <div className="card-item flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-charcoal">{title}</h2>
          {aside}
        </div>
        {children}
      </div>
    </SectionReveal>
  </section>
);

/**
 * The order DETAIL (`/panel/pedidos/:id`) — everything about one order, and the only place its
 * heavier actions live.
 *
 * **Roles are the backend's answer, not this page's opinion.** The primary buttons are rendered
 * from `order.actions`, which the lifecycle engine already narrowed for the requesting user: an
 * Admin gets advance + rewind + cancel on any order, an assigned Driver gets advance + cancel on
 * theirs, and anyone else gets an empty array and therefore no buttons. Only the two ADMIN-exclusive
 * powers are gated here as well — changing the status freely (jump / reopen) and deleting — because
 * they have no representation in `actions`. Reaching another worker's order by URL doesn't happen:
 * the backend answers a Driver the same 404 as a missing order, and the page shows not-found.
 *
 * **Nothing on this page repaints.** Arriving cold, the skeleton dissolves into the content in place
 * (`SectionReveal`). Once loaded, a lifecycle move rewrites three regions at once — the state card's
 * line and buttons, the logistics actuals, the history trail — and each ADAPTS: `useMorphOnChange`
 * eases the region's height while the parts that survived glide and the new ones rise in, and the
 * status chip morphs its width through `MorphSwap` exactly as the agenda ticket's does. Everything
 * below a growing region slides with it in normal flow.
 */
const OrderDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const params = useParams({ from: '/panel/pedidos_/$orderId' });
  const orderId = Number(params.orderId);
  const panelNavigate = usePanelNavigate();
  const isAdmin = useHasRole([Role.Admin]);
  const root = useRef<HTMLDivElement>(null);

  const { data: order, isLoading, isError, error, isFetching, refetch } = useOrder(orderId);
  const { data: catalog } = useOrdersCatalog();
  const [advancing, setAdvancing] = useState<OrderAction | undefined>(undefined);
  const [paying, setPaying] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** The evidence set being viewed full-size — ONE step's photos, never the whole order's. */
  const [viewing, setViewing] = useState<
    { photos: OrderEvidence[]; index: number; label: string } | undefined
  >(undefined);

  // A 404 is the final answer for BOTH an unknown order and one a Driver may not see — the backend
  // deliberately doesn't distinguish, so neither does this.
  const notFound = isError && getStatus(error as AxiosError) === 404;
  const failed = isError && !notFound;
  const cold = isLoading && !order;

  // The three regions a lifecycle move rewrites. Keyed by what actually changed, so a background
  // refetch returning identical data animates nothing.
  const stateBody = useMorphOnChange<HTMLDivElement>(order?.status.id ?? 0, '.state-flip');
  const logistics = useMorphOnChange<HTMLDivElement>(
    `${order?.assignee?.id ?? ''}|${order?.deliveredAt ?? ''}|${order?.collectedAt ?? ''}|${order?.readyAt ?? ''}`,
    '.fact-flip',
  );
  const history = useMorphOnChange<HTMLOListElement>(
    order?.statusHistory.length ?? 0,
    '.history-flip',
  );

  // The evidence card only exists once a documented step has been taken, so it can APPEAR under a
  // page that is already settled. It grows its space open there instead of popping into the middle
  // of the column — but only then: on the FIRST paint of the order it rides `SectionReveal`'s
  // cascade like every other card, and two entrances on one element would fight.
  const evidenceCard = useRef<HTMLElement>(null);
  const hadEvidence = useRef(false);
  const painted = useRef(false);
  const hasEvidence = (order?.evidence.length ?? 0) > 0;
  useLayoutEffect(() => {
    const appeared = hasEvidence && !hadEvidence.current && painted.current;
    hadEvidence.current = hasEvidence;
    if (order) painted.current = true;
    if (appeared) growCardIn(evidenceCard.current, COLUMN_GAP);
  }, [hasEvidence, order]);

  usePanelPageMotion(
    useMemo(
      () => ({
        enter: (options) => staggerIn(root.current, '.reveal-item', options),
        exit: () => staggerOut(root.current, '.reveal-item'),
      }),
      [],
    ),
  );

  // The page plays its own entrance on mount, and again when an ERROR panel replaces the content.
  // Deliberately NOT keyed on `loading`: skeleton → content is `SectionReveal`'s move, and replaying
  // the page stagger there would blank everything and re-run the whole entrance.
  useLayoutEffect(() => {
    staggerIn(root.current, '.reveal-item');
  }, [notFound, failed]);

  const goBack = (): void => panelNavigate('/panel/pedidos');

  const backButton = (
    <button
      type="button"
      onClick={goBack}
      className="reveal-item inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-control px-2 py-1 text-sm text-charcoal/60 outline-none transition-colors duration-200 hover:bg-charcoal/[0.04] hover:text-charcoal focus-visible:ring-2 focus-visible:ring-charcoal/30"
    >
      <HiOutlineArrowLeft aria-hidden className="size-4" />
      {t(`${KEY}.back`)}
    </button>
  );

  // Where "abrir mapa" sends them — the order's own PIN, or nothing (see `orderDestination`).
  const mapsDestination = orderDestination(order?.deliveryAddress, order?.deliveryCoords);
  // Is there still a trip to make? Navigation is offered while the order has somewhere left to go,
  // which is NOT the same as "the next step stamps an actual". `tracksEvent` is DELIVERY on
  // *Entregado* and COLLECTION on *Recolectado* — the steps that CONFIRM arrival — so gating on it
  // hid the button through "En ruta", i.e. through exactly the moment the driver is leaving and
  // needs directions. Derived from the tracked actuals, like every other pending-work rule.
  const hasPendingTrip =
    order != null &&
    order.cancelledAt === undefined &&
    order.readyAt === undefined &&
    (order.deliveredAt === undefined ||
      (order.pickupAt !== undefined && order.collectedAt === undefined));
  const forward = order?.actions.find((action) => action.kind === 'forward');
  const backward = order?.actions.find((action) => action.kind === 'backward');
  const disruptive = order?.actions.filter((action) => action.kind === 'disruptive') ?? [];
  // Photos are grouped under the step they document; a step with none simply doesn't appear (a
  // rewind destroyed them, or the retention purge did — the trail still proves the step happened).
  const evidenceByStatus = (order?.evidence ?? []).reduce<Record<number, OrderEvidence[]>>(
    (groups, photo) => ({ ...groups, [photo.statusId]: [...(groups[photo.statusId] ?? []), photo] }),
    {},
  );
  const statusName = (id: number): string =>
    catalog?.serviceStatuses.find((status) => status.id === id)?.name ?? `#${id}`;

  return (
    <div ref={root} className="flex flex-1 flex-col gap-4">
      {backButton}

      {notFound || failed ? (
        <div className="reveal-item">
          <ProductsStatus
            tone={notFound ? 'empty' : 'error'}
            title={t(`${KEY}.${notFound ? 'notFound' : 'error'}.title`)}
            description={t(`${KEY}.${notFound ? 'notFound' : 'error'}.description`)}
            action={
              notFound ? (
                <Button size="sm" color={SECONDARY_COLOR} onClick={goBack}>
                  {t(`${KEY}.notFound.action`)}
                </Button>
              ) : (
                <Button
                  variant="soft"
                  color={SECONDARY_COLOR}
                  size="sm"
                  loading={isFetching}
                  startIcon={<HiOutlineArrowPath className="size-4" />}
                  onClick={() => void refetch()}
                >
                  {t(`${KEY}.error.retry`)}
                </Button>
              )
            }
          />
        </div>
      ) : (
        <>
          {/* One announcement for the whole load — each card is `aria-hidden` while it shimmers. */}
          {cold && (
            <span role="status" aria-label={t(`${KEY}.loading`)} aria-busy className="sr-only" />
          )}

          {/* STATE + ACTIONS — the reason anyone opens this page. */}
          <Section
            title={t(`${KEY}.state.title`)}
            loading={cold}
            step={0}
            skeleton={
              <SkeletonBody titleWidth="w-32" aside>
                <div className="flex flex-col gap-3">
                  <Bar w="w-56" h="h-3" />
                  <div className="flex flex-wrap gap-2">
                    <Bar w="w-36" h="h-9" />
                    <Bar w="w-32" h="h-9" />
                  </div>
                </div>
              </SkeletonBody>
            }
            aside={
              // The pill sizes itself to the morphing label inside it, and its TINT eases natively
              // — a CSS transition retargets mid-flight, so colour and word stay in step even
              // through a rapid Pendiente → En ruta → Entregado run.
              order && (
                <span
                  className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-[background-color,color] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${statusTone(order.status.colorKey)}`}
                >
                  <MorphSwap swapKey={order.status.id}>{order.status.name}</MorphSwap>
                </span>
              )
            }
          >
            {order && (
              <div ref={stateBody} className="card-item flex flex-col gap-3">
                {/* The line is keyed by the STATUS, so a move brings a new sentence in rather than
                    rewriting the old one under the reader's eyes. */}
                <p
                  data-flip-id={`state-line-${order.status.id}`}
                  className="state-flip text-sm text-charcoal/60"
                >
                  {order.cancelledAt !== undefined
                    ? t(`${KEY}.state.cancelled`, { reason: order.cancelReason ?? '—' })
                    : order.readyAt !== undefined
                      ? t(`${KEY}.state.finished`)
                      : order.nextStatus
                        ? t(`${KEY}.state.next`, { status: order.nextStatus.name })
                        : t(`${KEY}.state.idle`)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {forward && (
                    <Button
                      data-flip-id={`forward-${forward.statusId}`}
                      className="state-flip"
                      size="sm"
                      color={SECONDARY_COLOR}
                      endIcon={<HiOutlineArrowRight className="size-4" />}
                      onClick={() => setAdvancing(forward)}
                    >
                      {t(`${KEY}.actions.advance`, { status: forward.statusName })}
                    </Button>
                  )}
                  {/* Navigation sits beside the advance action while the order still HAS a trip to
                      make and carries a pin. Not gated on `tracksEvent`: that flag marks the step
                      which CONFIRMS arrival (Entregado / Recolectado), so using it hid the button
                      through "En ruta" — the exact moment the driver is leaving and needs it. It
                      rides the same `.state-flip` group, so it glides in and out with the rest of
                      the action row as the order walks its pipeline. */}
                  {hasPendingTrip && mapsDestination && (
                    <span data-flip-id="open-in-maps" className="state-flip">
                      {/* `sm`, matching the advance button beside it — two actions in one row must
                          share a height. */}
                      <OpenInMapsButton destination={mapsDestination} size="sm" />
                    </span>
                  )}
                  {/* Recording PAYMENT — its own axis, so it stands beside the lifecycle actions
                      rather than inside them, and stays offered until the money is actually in.
                      Full label here: the detail page has the room a scannable card does not. */}
                  {isAdmin && !order.isPaid && (
                    <span data-flip-id="pay-order" className="state-flip">
                      <Button
                        variant="soft"
                        size="sm"
                        color={SECONDARY_COLOR}
                        startIcon={<HiOutlineBanknotes className="size-4" />}
                        onClick={() => setPaying(true)}
                      >
                        {t(`${KEY}.actions.pay`)}
                      </Button>
                    </span>
                  )}
                  {backward && (
                    <Button
                      data-flip-id={`backward-${backward.statusId}`}
                      className="state-flip"
                      variant="soft"
                      size="sm"
                      color={SECONDARY_COLOR}
                      startIcon={<HiOutlineArrowUturnLeft className="size-4" />}
                      onClick={() => setAdvancing(backward)}
                    >
                      {t(`${KEY}.actions.rewind`, { status: backward.statusName })}
                    </Button>
                  )}
                  {/* ADMIN-only powers: they have no representation in `actions` (a jump isn't a
                      single offered move, and reopening a cancelled order offers nothing). */}
                  {isAdmin && (
                    <>
                      <Button
                        data-flip-id={`admin-${order.cancelledAt !== undefined ? 'reopen' : 'change'}`}
                        className="state-flip"
                        variant="soft"
                        size="sm"
                        color={SECONDARY_COLOR}
                        startIcon={<HiOutlineArrowPath className="size-4" />}
                        onClick={() => setChangingStatus(true)}
                      >
                        {t(
                          `${KEY}.actions.${order.cancelledAt !== undefined ? 'reopen' : 'changeStatus'}`,
                        )}
                      </Button>
                      {/* Editing rewrites what was AGREED (client, window, products, money); it
                          never touches where the order stands. Admin-only, like the backend's PUT. */}
                      <Button
                        data-flip-id="admin-edit"
                        className="state-flip"
                        variant="soft"
                        size="sm"
                        color={SECONDARY_COLOR}
                        startIcon={<HiOutlinePencilSquare className="size-4" />}
                        onClick={() => panelNavigate(`/panel/pedidos/${order.id}/editar`)}
                      >
                        {t(`${KEY}.actions.edit`)}
                      </Button>
                    </>
                  )}
                  {/* Cancelling comes LAST, after every ordinary move: it is the one action here
                      that ends the order, and it should never sit between two everyday buttons
                      where a hurried tap can find it. */}
                  {disruptive.map((action) => (
                    <Button
                      key={action.statusId}
                      data-flip-id={`cancel-${action.statusId}`}
                      className="state-flip"
                      variant="soft"
                      size="sm"
                      color={DANGER_COLOR}
                      startIcon={<HiOutlineXMark className="size-4" />}
                      onClick={() => setAdvancing(action)}
                    >
                      {t(`${KEY}.actions.cancel`)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* CLIENT + DELIVERY SNAPSHOTS — what was agreed, captured at order time. */}
          <Section
            title={t(`${KEY}.client.title`)}
            loading={cold}
            step={1}
            skeleton={
              <SkeletonBody titleWidth="w-36">
                <SkeletonFacts rows={3} />
              </SkeletonBody>
            }
          >
            {order && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Fact label={t(`${KEY}.client.name`)} value={order.clientName} />
                <Fact label={t(`${KEY}.client.contact`)} value={order.deliveryContact} />
                <Fact label={t(`${KEY}.client.address`)} value={order.deliveryAddress} />
                {/* Directly under the address: this is what the person standing at the gate needs,
                    and it is the only delivery detail written FOR the driver. */}
                <Fact
                  label={t(`${KEY}.client.instructions`)}
                  value={order.deliveryInstructions}
                />
                {/* Whether this order has a PIN is a fact about it, so it is stated here rather than
                    being inferable only from whether a button happens to be offered. Without this
                    row a saved pin was invisible on any step that isn't a travel step, which reads
                    exactly like the pin was never saved. */}
                <Fact
                  label={t(`${KEY}.client.coords`)}
                  value={
                    order.deliveryCoords
                      ? `${order.deliveryCoords.lat}, ${order.deliveryCoords.lng}`
                      : t(`${KEY}.client.noCoords`)
                  }
                />
                <Fact label={t(`${KEY}.client.eventType`)} value={order.eventType.name} />
                <Fact label={t(`${KEY}.client.description`)} value={order.description} />
                <Fact label={t(`${KEY}.client.comment`)} value={order.comment} />
              </div>
            )}
          </Section>

          {/* LOGISTICS — the actuals fill in as the order advances, so this grid MORPHS. */}
          <Section
            title={t(`${KEY}.logistics.title`)}
            loading={cold}
            step={2}
            skeleton={
              <SkeletonBody titleWidth="w-24">
                <SkeletonFacts rows={3} />
              </SkeletonBody>
            }
          >
            {order && (
              <div ref={logistics} className="grid gap-4 sm:grid-cols-2">
                <Fact label={t(`${KEY}.logistics.delivery`)} value={formatMoment(order.deliveryAt)} />
                <Fact
                  label={t(`${KEY}.logistics.pickup`)}
                  value={
                    order.pickupAt ? formatMoment(order.pickupAt) : t(`${KEY}.logistics.noPickup`)
                  }
                />
                <Fact
                  label={t(`${KEY}.logistics.assignee`)}
                  value={order.assignee?.name ?? t(`${KEY}.logistics.unassigned`)}
                />
                <Fact
                  label={t(`${KEY}.logistics.delivered`)}
                  value={order.deliveredAt ? formatMoment(order.deliveredAt) : undefined}
                />
                <Fact
                  label={t(`${KEY}.logistics.collected`)}
                  value={order.collectedAt ? formatMoment(order.collectedAt) : undefined}
                />
                <Fact
                  label={t(`${KEY}.logistics.ready`)}
                  value={order.readyAt ? formatMoment(order.readyAt) : undefined}
                />
              </div>
            )}
          </Section>

          {/* LINES */}
          <Section
            title={t(`${KEY}.lines.title`)}
            loading={cold}
            step={3}
            skeleton={
              <SkeletonBody titleWidth="w-28">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Bar w="w-40" />
                    <Bar w="w-28" h="h-2.5" />
                  </div>
                  <Bar w="w-16" />
                </div>
              </SkeletonBody>
            }
          >
            {order && (
              <ul className="card-item flex flex-col divide-y divide-black/[0.05]">
                {order.lines.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-start justify-between gap-4 py-2.5 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-charcoal">{line.productName}</p>
                      <p className="text-xs text-charcoal/50">
                        {t(`${KEY}.lines.detail`, {
                          quantity: line.quantity,
                          price: money(order.currency.symbol, line.unitaryPrice),
                        })}
                        {' · '}
                        {t(`${KEY}.lines.${line.isRental ? 'rental' : 'sale'}`)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-charcoal">
                      {money(order.currency.symbol, line.parcialPrice)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* MONEY */}
          <Section
            title={t(`${KEY}.money.title`)}
            loading={cold}
            step={4}
            skeleton={
              <SkeletonBody titleWidth="w-20">
                <div className="flex flex-col gap-2">
                  <Bar w="w-full" h="h-3" />
                  <Bar w="w-2/3" h="h-3" />
                </div>
              </SkeletonBody>
            }
          >
            {order && (
              <div className="flex flex-col gap-2 text-sm">
                <div className="card-item flex justify-between gap-4 text-charcoal/60">
                  <span>{t(`${KEY}.money.lines`)}</span>
                  <span className="tabular-nums">
                    {money(
                      order.currency.symbol,
                      order.lines.reduce((sum, line) => sum + line.parcialPrice, 0),
                    )}
                  </span>
                </div>
                {order.deliveryAmount !== undefined && (
                  <div className="card-item flex justify-between gap-4 text-charcoal/60">
                    <span>{t(`${KEY}.money.delivery`)}</span>
                    <span className="tabular-nums">
                      {money(order.currency.symbol, order.deliveryAmount)}
                    </span>
                  </div>
                )}
                {order.discountAmount !== undefined && (
                  <div className="card-item flex justify-between gap-4 text-charcoal/60">
                    <span>{t(`${KEY}.money.discount`)}</span>
                    <span className="tabular-nums">
                      −{money(order.currency.symbol, order.discountAmount)}
                    </span>
                  </div>
                )}
                <div className="card-item flex justify-between gap-4 border-t border-black/[0.06] pt-2 font-semibold text-charcoal">
                  <span>{t(`${KEY}.money.total`)}</span>
                  <span className="tabular-nums">
                    {money(order.currency.symbol, order.totalAmount)}
                  </span>
                </div>
                <div className="mt-1 grid gap-4 sm:grid-cols-2">
                  <Fact
                    label={t(`${KEY}.money.deposit`)}
                    value={
                      order.depositAmount !== undefined
                        ? money(order.currency.symbol, order.depositAmount)
                        : undefined
                    }
                  />
                  <Fact label={t(`${KEY}.money.method`)} value={order.paymentMethod?.name} />
                  <Fact label={t(`${KEY}.money.status`)} value={order.paymentStatus.name} />
                  <Fact
                    label={t(`${KEY}.money.paidAt`)}
                    value={order.paidAt ? formatMoment(order.paidAt) : undefined}
                  />
                </div>
              </div>
            )}
          </Section>

          {/* EVIDENCE — grouped by the step it documents. Absent from the skeleton on purpose: a
              placeholder for photos that may not exist would promise something. It joins the column
              by GROWING its space open (see the layout effect) instead of popping into the middle. */}
          {order && hasEvidence && (
            <section
              ref={evidenceCard}
              className="reveal-item flex flex-col gap-4 rounded-card bg-white p-5 ring-1 ring-black/[0.04]"
            >
              <h2 className="text-sm font-semibold text-charcoal">{t(`${KEY}.evidence.title`)}</h2>
              <div className="flex flex-col gap-4">
                {Object.entries(evidenceByStatus).map(([statusId, photos]) => (
                  <div key={statusId} className="flex flex-col gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-charcoal/40">
                      {statusName(Number(statusId))}
                    </p>
                    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {photos.map((photo, index) => (
                        <li key={photo.id}>
                          {/* Opens the viewer on THIS step's photos only — a delivery's evidence and
                              a collection's are separate records, so paging must never cross from
                              one into the other. */}
                          <button
                            type="button"
                            aria-label={t(`${KEY}.evidence.open`, {
                              status: statusName(Number(statusId)),
                            })}
                            onClick={() =>
                              setViewing({
                                photos,
                                index,
                                label: statusName(Number(statusId)),
                              })
                            }
                            className="block aspect-square w-full cursor-pointer overflow-hidden rounded-control ring-1 ring-black/[0.06] outline-none transition-[scale] duration-200 hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-charcoal/40 motion-reduce:transition-none"
                          >
                            <img
                              src={photo.url}
                              alt={t(`${KEY}.evidence.photoAlt`, {
                                status: statusName(Number(statusId)),
                              })}
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* TRAIL — the append-only record of who moved it, and when. Each move APPENDS a row, so
              the list morphs: the entries already there hold still and the new one rises in. */}
          <Section
            title={t(`${KEY}.history.title`)}
            loading={cold}
            step={5}
            skeleton={
              <SkeletonBody titleWidth="w-24">
                <div className="flex flex-col gap-3">
                  <Bar w="w-2/3" h="h-3" />
                  <Bar w="w-1/2" h="h-3" />
                </div>
              </SkeletonBody>
            }
          >
            {order && (
              <ol ref={history} className="card-item flex flex-col">
                {order.statusHistory.map((entry) => (
                  <li
                    key={entry.id}
                    data-flip-id={entry.id}
                    className="history-flip flex items-start gap-3 pt-3 first:pt-0"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-charcoal/25"
                    />
                    <div className="min-w-0">
                      <p className="text-sm text-charcoal">
                        {entry.from
                          ? t(`${KEY}.history.moved`, { from: entry.from.name, to: entry.to.name })
                          : t(`${KEY}.history.created`, { to: entry.to.name })}
                      </p>
                      <p className="text-xs text-charcoal/50">
                        {formatMoment(entry.at)} · {entry.byUserName}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {/* DANGER — admin only, last on the page, never beside the everyday actions. */}
          {isAdmin && (
            <Section
              title={t(`${KEY}.danger.title`)}
              loading={cold}
              step={6}
              skeleton={
                <SkeletonBody titleWidth="w-28">
                  <div className="flex items-center justify-between gap-4">
                    <Bar w="w-2/3" h="h-3" />
                    <Bar w="w-28" h="h-9" />
                  </div>
                </SkeletonBody>
              }
            >
              <div className="card-item flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-prose text-sm text-charcoal/55">
                  {t(`${KEY}.danger.description`)}
                </p>
                <Button
                  variant="soft"
                  size="sm"
                  color={DANGER_COLOR}
                  startIcon={<HiOutlineTrash className="size-4" />}
                  onClick={() => setDeleting(true)}
                >
                  {t(`${KEY}.danger.delete`)}
                </Button>
              </div>
            </Section>
          )}
        </>
      )}

      {order && (
        <>
          <OrderAdvanceModal
            order={advancing ? order : undefined}
            action={advancing}
            onClose={() => setAdvancing(undefined)}
          />
          {/* The same payment dialog the agenda and the dashboard open. */}
          <OrderPaymentModal
            order={paying ? order : undefined}
            onClose={() => setPaying(false)}
          />
          <OrderStatusModal
            order={changingStatus ? order : undefined}
            statuses={catalog?.serviceStatuses ?? []}
            onClose={() => setChangingStatus(false)}
          />
          <OrderDeleteModal
            order={deleting ? order : undefined}
            onClose={() => setDeleting(false)}
            onDeleted={goBack}
          />
          {viewing && (
            <ImageLightbox
              images={viewing.photos}
              initialIndex={viewing.index}
              label={viewing.label}
              onClose={() => setViewing(undefined)}
            />
          )}
        </>
      )}
    </div>
  );
};

export default OrderDetailPage;

