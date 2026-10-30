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
  HiOutlineShieldExclamation,
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
import {
  bringIntoPanelView,
  growCardIn,
  SECTION_REVEAL_STEP,
  staggerIn,
  staggerOut,
} from '../pageMotion';
import ActionRow from '../ActionRow';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import useMorphOnChange from '../useMorphOnChange';
import OrderDocumentButton from '../documents/OrderDocumentButton';
import ProductsStatus from '../products/ProductsStatus';
import { lineDisplayName } from '../products/productVariations';
import SectionReveal from '../products/SectionReveal';
import { formatMoment } from './orderDayGroups';
import OrderAdvanceModal from './OrderAdvanceModal';
import OrderDeleteModal from './OrderDeleteModal';
import OrderPaymentModal from './OrderPaymentModal';
import OrderBalanceSummary from './OrderBalanceSummary';
import OrderDepositCard from './OrderDepositCard';
import OrderDepositCollectionModal, { type DepositCollectionMode } from './OrderDepositCollectionModal';
import OrderDepositRefundModal from './OrderDepositRefundModal';
import OrderPaymentUndoModal from './OrderPaymentUndoModal';
import OrderSettlementUndoModal from './OrderSettlementUndoModal';
import OrderStatusModal from './OrderStatusModal';
import { statusTone } from './statusTone';
import { useOrder } from './useOrder';
import { isTravelStep } from './useOrderLifecycle';
import { useOrdersCatalog } from './useOrdersCatalog';
import type {
  OrderAction,
  OrderDepositHistoryEntry,
  OrderEvidence,
  OrderStatusChange,
} from './order.types';

const KEY = 'modules.panel.orders.detail';
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';
/** amber-700 — the "pending" tone the deposit chip wears everywhere, as a button colour. */
const DEPOSIT_COLOR = '#b45309';
/** The column's `gap-4`, in px — what a card joining it has to swallow while it grows open. */
const COLUMN_GAP = 16;

const MONEY = new Intl.NumberFormat('es-GT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `Q 1,250.00` — the currency is the order's own, so the symbol travels with every amount. */
const money = (symbol: string, value: number): string => `${symbol} ${MONEY.format(value)}`;

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

/** One row of the order's history: a status change, or an entry of the deposit's own trail. */
type TrailEntry =
  | { key: string; at: string; status: OrderStatusChange }
  | { key: string; at: string; deposit: OrderDepositHistoryEntry };

/**
 * The status changes and the deposit's entries as ONE chronological trail. The deposit is its own
 * door (never a lifecycle step), but "who recorded what, when" is one story to the reader. The sort
 * is stable over the concatenation, so on an identical instant the status change reads first.
 */
const mergeTrail = (
  statuses: readonly OrderStatusChange[],
  deposits: readonly OrderDepositHistoryEntry[],
): TrailEntry[] =>
  [
    ...statuses.map((status) => ({ key: `s-${status.id}`, at: status.at, status })),
    ...deposits.map((deposit) => ({ key: `d-${deposit.id}`, at: deposit.at, deposit })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

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
  const [undoingPayment, setUndoingPayment] = useState(false);
  const [undoingSettlement, setUndoingSettlement] = useState(false);
  const [refundingDeposit, setRefundingDeposit] = useState(false);
  const [collectionMode, setCollectionMode] = useState<DepositCollectionMode | undefined>(undefined);
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
  //
  // The state card's height answers to BOTH axes — a step changes the sentence and the buttons, and
  // recording money swaps one button for another, which can re-wrap the row. Keyed on the status
  // alone, taking a payment resized the card in a single frame. Its `.state-flip` ITEM (the sentence)
  // still moves only with the status, which is what `itemsKey` is for: the box adapts while the line
  // that did not change stays perfectly still. The buttons are the `ActionRow`'s own business.
  const stateBody = useMorphOnChange<HTMLDivElement>(
    `${order?.status.id ?? 0}|${order?.isPaid ?? false}|${order?.depositSettlementPending ?? false}`,
    '.state-flip',
    order?.status.id ?? 0,
  );
  const logistics = useMorphOnChange<HTMLDivElement>(
    `${order?.assignee?.id ?? ''}|${order?.deliveredAt ?? ''}|${order?.collectedAt ?? ''}|${order?.readyAt ?? ''}`,
    '.fact-flip',
  );
  // The trail is the status changes AND the deposit's own entries, so either kind appending a row
  // re-keys the morph.
  const history = useMorphOnChange<HTMLOListElement>(
    `${order?.statusHistory.length ?? 0}|${order?.depositHistory.length ?? 0}`,
    '.history-flip',
  );
  // The deposit card, so the state card's "Depósito pendiente" can take the admin to it.
  const depositCard = useRef<HTMLElement>(null);

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

  // "Depósito pendiente" in the state card: the deposit's decision lives on its OWN card (it is its
  // own door, never a lifecycle step), so this only takes the admin there — the card comes into view
  // the way a named section does, and focus moves to it, so the next Tab is "Devolver depósito".
  const goToDeposit = (): void => {
    const card = depositCard.current;
    /* v8 ignore next -- the button is offered only while the card is rendered (same block, same
       render); the guard is a type narrowing */
    if (!card) return;
    bringIntoPanelView(card, { smooth: true });
    card.focus({ preventScroll: true });
  };
  const trail = order ? mergeTrail(order.statusHistory, order.depositHistory) : [];

  /**
   * The state card's action row, in the order it is read.
   *
   * The forward move leads, navigation sits beside it (only while that move is somebody DRIVING),
   * money comes next as its own axis, then the paperwork, then the ways back — and cancelling comes
   * LAST, after every ordinary move: it is the one action here that ends the order, and it must
   * never sit between two everyday buttons where a hurried tap can find it.
   *
   * Each entry's `key` is what the action IS, not where it sits — `advance` keeps its key while its
   * label morphs from "Marcar En ruta" to "Marcar Entregado", so the button adapts in place instead
   * of being replaced, and `pay` genuinely leaves when it becomes `undo-pay`.
   */
  const actionItems = order
    ? [
        ...(forward
          ? [
              {
                key: 'advance',
                node: (
                  <Button
                    size="sm"
                    color={SECONDARY_COLOR}
                    endIcon={<HiOutlineArrowRight className="size-4" />}
                    onClick={() => setAdvancing(forward)}
                  >
                    {/* The label morphs rather than swapping, exactly as on the agenda ticket — the
                        button widens into its new step instead of blinking between two words. */}
                    <MorphSwap swapKey={forward.statusId}>
                      {t(`${KEY}.actions.advance`, { status: forward.statusName })}
                    </MorphSwap>
                  </Button>
                ),
              },
            ]
          : []),
        // `sm`, matching the advance button beside it — two actions in one row must share a height.
        ...(isTravelStep(forward) && mapsDestination
          ? [{ key: 'maps', node: <OpenInMapsButton destination={mapsDestination} size="sm" /> }]
          : []),
        // Recording PAYMENT — its own axis, so it stands beside the lifecycle actions rather than
        // inside them. Full label here: the detail page has the room a scannable card does not.
        ...(isAdmin && !order.isPaid
          ? [
              {
                key: 'pay',
                node: (
                  <Button
                    variant="soft"
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlineBanknotes className="size-4" />}
                    onClick={() => setPaying(true)}
                  >
                    {t(`${KEY}.actions.pay`)}
                  </Button>
                ),
              },
            ]
          : []),
        // …and the way back from a mis-tap. It exists ONLY here: the agenda and the dashboard are
        // scanning surfaces where the one money action that belongs is the one that moves the job
        // forward, and an undo beside it invites the wrong tap at a glance.
        ...(isAdmin && order.isPaid
          ? [
              {
                key: 'undo-pay',
                node: (
                  <Button
                    variant="soft"
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlineArrowUturnLeft className="size-4" />}
                    onClick={() => setUndoingPayment(true)}
                  >
                    {t(`${KEY}.actions.undoPay`)}
                  </Button>
                ),
              },
            ]
          : []),
        // The deposit is waiting for its decision (delivered, not recorded — the API's flag). Not a
        // lifecycle step and not an action in itself: it takes the admin to the Depósito card, where
        // "Devolver depósito" / "Reportar daños" live. Amber, like the agenda's chip for the same fact.
        ...(isAdmin && order.depositSettlementPending && order.securityDeposit
          ? [
              {
                key: 'deposit',
                node: (
                  <Button
                    variant="soft"
                    size="sm"
                    color={DEPOSIT_COLOR}
                    startIcon={<HiOutlineShieldExclamation className="size-4" />}
                    onClick={goToDeposit}
                  >
                    {t(`${KEY}.actions.depositPending`)}
                  </Button>
                ),
              },
            ]
          : []),
        // The order's DOCUMENT — offered at every step but a cancelled one, because it is how the
        // client is told what they owe, not a receipt that waits for payment. The component itself
        // decides whether to render (EPIC-2-DOCUMENTS Phase 1).
        ...(isAdmin ? [{ key: 'document', node: <OrderDocumentButton order={order} /> }] : []),
        ...(backward
          ? [
              {
                key: 'rewind',
                node: (
                  <Button
                    variant="soft"
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlineArrowUturnLeft className="size-4" />}
                    onClick={() => setAdvancing(backward)}
                  >
                    <MorphSwap swapKey={backward.statusId}>
                      {t(`${KEY}.actions.rewind`, { status: backward.statusName })}
                    </MorphSwap>
                  </Button>
                ),
              },
            ]
          : []),
        // ADMIN-only powers: they have no representation in `actions` (a jump isn't a single offered
        // move, and reopening a cancelled order offers nothing).
        ...(isAdmin
          ? [
              {
                key: 'change-status',
                node: (
                  <Button
                    variant="soft"
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlineArrowPath className="size-4" />}
                    onClick={() => setChangingStatus(true)}
                  >
                    <MorphSwap swapKey={order.cancelledAt !== undefined ? 'reopen' : 'change'}>
                      {t(
                        `${KEY}.actions.${order.cancelledAt !== undefined ? 'reopen' : 'changeStatus'}`,
                      )}
                    </MorphSwap>
                  </Button>
                ),
              },
              {
                // Editing rewrites what was AGREED (client, window, products, money); it never
                // touches where the order stands. Admin-only, like the backend's PUT.
                key: 'edit',
                node: (
                  <Button
                    variant="soft"
                    size="sm"
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlinePencilSquare className="size-4" />}
                    onClick={() => panelNavigate(`/panel/pedidos/${order.id}/editar`)}
                  >
                    {t(`${KEY}.actions.edit`)}
                  </Button>
                ),
              },
            ]
          : []),
        ...disruptive.map((action) => ({
          key: `cancel-${action.statusId}`,
          node: (
            <Button
              variant="soft"
              size="sm"
              color={DANGER_COLOR}
              startIcon={<HiOutlineXMark className="size-4" />}
              onClick={() => setAdvancing(action)}
            >
              {t(`${KEY}.actions.cancel`)}
            </Button>
          ),
        })),
      ]
    : [];

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
                  {/* The placeholder is the SHAPE of what lands: an admin's row is five or six
                      actions that wrap onto two lines, so two lone bars had the card grow by half
                      its height the moment the data arrived. `h-9` is the `sm` button height. */}
                  <div className="flex flex-wrap gap-2">
                    <Bar w="w-36" h="h-9" />
                    <Bar w="w-28" h="h-9" />
                    <Bar w="w-32" h="h-9" />
                    <Bar w="w-24" h="h-9" />
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
                {/* Every action here comes and goes with the order's state — the map appears when
                    the van leaves, "Registrar pago" becomes "Deshacer pago" the moment money is
                    recorded, the rewind exists only once there is somewhere to rewind to. So the
                    row is an `ActionRow`: what leaves fades where it stands, and only then do the
                    survivors glide into the space it vacated. Its keys are the actions' identities,
                    never their positions — which is what lets the middle one disappear and the two
                    around it close the gap as one movement. */}
                <ActionRow items={actionItems} className="flex flex-wrap items-center gap-2" />
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
                      <p className="truncate text-sm text-charcoal">{lineDisplayName(line)}</p>
                      <p className="text-xs text-charcoal/50">
                        {t(`${KEY}.lines.detail`, {
                          quantity: line.quantity,
                          price: money(order.currency.symbol, line.unitaryPrice),
                        })}
                        {' · '}
                        {t(`${KEY}.lines.${line.isRental ? 'rental' : 'sale'}`)}
                        {/* What the deposit settlement recorded as lost/broken on THIS line —
                            stated where the line is, so the count is never only in the breakdown. */}
                        {line.damagedQuantity > 0 && (
                          <span className="text-red-600">
                            {' · '}
                            {t(`${KEY}.lines.damaged`, { count: line.damagedQuantity })}
                          </span>
                        )}
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
                {/* The CUADRE — the one amount that changes hands, and which way. The deposit joins
                    it here, never the cost above. */}
                <OrderBalanceSummary order={order} />
                <div className="mt-1 grid gap-4 sm:grid-cols-2">
                  {/* The anticipo as a fact once the order is paid; while it is not, the cuadre
                      above already subtracts it, so it is not said twice. */}
                  <Fact
                    label={t(`${KEY}.money.deposit`)}
                    value={
                      order.depositAmount !== undefined && order.paidAt !== undefined
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

          {/* DEPÓSITO — only for an order that can carry a deposit or a damage (the API omits the
              block otherwise). Absent from the skeleton for the evidence card's reason: a
              placeholder would promise a section most orders never have. */}
          {order?.securityDeposit && (
            <OrderDepositCard
              ref={depositCard}
              order={order}
              deposit={order.securityDeposit}
              isAdmin={isAdmin}
              onRefund={() => setRefundingDeposit(true)}
              onReport={() => panelNavigate(`/panel/pedidos/${order.id}/danos`)}
              onUndo={() => setUndoingSettlement(true)}
              onCollection={setCollectionMode}
            />
          )}

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
                {trail.map((row) => {
                  // A status change keeps the trail's neutral dot; a deposit entry tints it by how
                  // it ended (emerald = went back whole, red = damages, neutral = undone), the same
                  // tones its chip wears on the Depósito card.
                  let label: string;
                  let detail: string | undefined;
                  let dot = 'bg-charcoal/25';
                  let byUserName: string;
                  if ('status' in row) {
                    const { status } = row;
                    byUserName = status.byUserName;
                    label = status.from
                      ? t(`${KEY}.history.moved`, { from: status.from.name, to: status.to.name })
                      : t(`${KEY}.history.created`, { to: status.to.name });
                  } else {
                    const { deposit } = row;
                    byUserName = deposit.byUserName;
                    const claims = deposit.claimsTotal ?? 0;
                    const balance = deposit.balanceDue ?? 0;
                    if (deposit.kind === 'UNDONE') {
                      label = t(`${KEY}.history.depositUndone`);
                    } else if (deposit.kind === 'COLLECTION_CLEARED') {
                      label = t(`${KEY}.history.collectionCleared`);
                    } else if (deposit.kind === 'RECEIVED') {
                      dot = 'bg-emerald-500/70';
                      label = t(`${KEY}.history.depositReceived`);
                      if (deposit.depositTotal !== undefined) {
                        detail = money(order.currency.symbol, deposit.depositTotal);
                      }
                    } else if (deposit.kind === 'WAIVED') {
                      dot = 'bg-amber-500/70';
                      label = t(`${KEY}.history.depositWaived`);
                      // The waive reason is an INTERNAL note — said as one.
                      if (deposit.note) {
                        detail = t(`${KEY}.history.internalNote`, { note: deposit.note });
                      }
                    } else {
                      dot = claims > 0 ? 'bg-red-500/70' : 'bg-emerald-500/70';
                      // `depositTotal` is the deposit HELD then — 0 unless it had been received
                      // (owner, 2026-10-28): a clean record with nothing in hand gave nothing
                      // back, so it never claims "Depósito devuelto".
                      const heldThen = (deposit.depositTotal ?? 0) > 0;
                      label =
                        deposit.kind === 'CORRECTED'
                          ? t(`${KEY}.history.depositCorrected`)
                          : t(
                              `${KEY}.history.${claims > 0 ? 'depositDamaged' : heldThen ? 'depositRefunded' : 'depositNoDamage'}`,
                            );
                      // A clean first record says everything in its label; a damage or a
                      // correction carries the money as it stood THEN.
                      if (deposit.kind === 'CORRECTED' || claims > 0) {
                        detail = [
                          heldThen
                            ? t(`${KEY}.history.depositSummary`, {
                                claims: money(order.currency.symbol, claims),
                                refund: money(order.currency.symbol, deposit.refundAmount ?? 0),
                              })
                            : t(`${KEY}.history.depositSummaryNoDeposit`, {
                                claims: money(order.currency.symbol, claims),
                              }),
                          ...(balance > 0
                            ? [
                                t(`${KEY}.history.depositBalance`, {
                                  balance: money(order.currency.symbol, balance),
                                }),
                              ]
                            : []),
                        ].join(' · ');
                      }
                    }
                  }
                  return (
                    <li
                      key={row.key}
                      data-flip-id={row.key}
                      className="history-flip flex items-start gap-3 pt-3 first:pt-0"
                    >
                      <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`} />
                      <div className="min-w-0">
                        <p className="text-sm text-charcoal">{label}</p>
                        {detail && <p className="text-xs text-charcoal/60">{detail}</p>}
                        <p className="text-xs text-charcoal/50">
                          {formatMoment(row.at)} · {byUserName}
                        </p>
                      </div>
                    </li>
                  );
                })}
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
          {/* …and its way back, which lives ONLY here. */}
          <OrderPaymentUndoModal
            order={undoingPayment ? order : undefined}
            onClose={() => setUndoingPayment(false)}
          />
          {/* "Cobro del depósito" — received / without deposit / "Corregir". */}
          <OrderDepositCollectionModal
            order={collectionMode ? order : undefined}
            mode={collectionMode}
            onClose={() => setCollectionMode(undefined)}
          />
          {/* The deposit's happy path — one confirm, nothing claimed. */}
          <OrderDepositRefundModal
            order={refundingDeposit ? order : undefined}
            onClose={() => setRefundingDeposit(false)}
          />
          {/* The settlement's way back — a confirm, because it clears a record (never money). */}
          <OrderSettlementUndoModal
            order={undoingSettlement ? order : undefined}
            onClose={() => setUndoingSettlement(false)}
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

