import { useNavigate, useSearch } from '@tanstack/react-router';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowPath, HiOutlinePlus } from 'react-icons/hi2';
import Button from '@components/Button';
import SkeletonFade from '@components/SkeletonFade';
import { Role } from '@constants/Roles';
import { useHasRole } from '@hooks/useRole';
import { useInfiniteScrollSentinel } from '@hooks/useInfiniteScrollSentinel';
import { collapseRowsOut, fadeUpIn, growRowsIn, rowRevealDelay, staggerIn, staggerOut } from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
// Shared status panel (empty/error family). Promote to @components when a third section needs it.
import ProductsStatus from '../products/ProductsStatus';
// Shared warm-list diff choreography (see its doc — the grid and the agenda have the same problem).
import { useGridListTransition } from '../products/useGridListTransition';
import { formatDayLabel, groupAgenda, groupHistory, type OrderDayGroup } from './orderDayGroups';
import type { OrderAction, OrderListItem } from './order.types';
import OrderAdvanceModal from './OrderAdvanceModal';
import OrdersViewSwitch from './OrdersViewSwitch';
import OrderTicket from './OrderTicket';
import OrderTicketSkeleton from './OrderTicketSkeleton';
import { ORDERS_VIEWS, activeOrdersView, type OrdersSearch, type OrdersView } from './ordersSearch';
import { useOrders } from './useOrders';

const KEY = 'modules.panel.orders';
const SECONDARY_COLOR = '#262626';

// The cold-load skeleton: enough ticket rows to read as "an agenda is coming" without flooding the
// screen. Data rows crossfade INTO these slots in place; leftover skeleton rows sweep out.
const SKELETON_ROWS = 6;
// How many shimmer rows an appending page shows — a list reveals ~this many rows near the
// sentinel; the real rows stagger in when the page lands.
const APPEND_SKELETONS = 4;

/** One rendered element of the flat, index-keyed row list — a day/owner header or an order slot
 *  (its `order` absent while the slot is still a skeleton: a cold load, or an underfilled resolve). */
type RenderRow =
  | { kind: 'ownerHeader'; owner: 'mine' | 'rest'; rowKey: string }
  | { kind: 'dayHeader'; group: OrderDayGroup; rowKey: string }
  | { kind: 'order'; index: number; order: OrderListItem | undefined };

/**
 * The orders screen (`/panel/pedidos`) — Epic-2's agenda, row-scoped by role (an Admin sees all,
 * grouped MINE-first vs the rest; a Driver only their assigned deliveries). Two views behind an
 * accessible segmented control, held in the URL (`?view=historial`): the **agenda** (still-work
 * orders, grouped by owner then day, ordered by next action) and the **history** (finished/cancelled,
 * newest first). The list is an infinite scroll, deliberately WITHOUT empty-day placeholders.
 *
 * Choreography follows the panel doctrine — nothing pops. The cold-load **resolves like the products
 * grid** (owner decision): the skeleton and the content share ONE set of index-keyed row slots under
 * a `[data-order-rows]` parent, so each slot's {@link SkeletonFade} crossfades its skeleton into its
 * ticket IN PLACE (a top-to-bottom {@link rowRevealDelay} wave); leftover skeleton rows sweep out
 * (`.orders-skel-orphan`), surplus rows + the day/owner headers sweep in (`.orders-enter`) — never a
 * whole-skeleton-out-then-content-in swap. A **view switch is a page transition in miniature**: the
 * displayed view is DECOUPLED from the URL intent, the current body staggers out laterally, then the
 * new body (cached tickets, or the next view's skeleton) staggers in — the segmented pill in step.
 * An appended page sweeps shimmer rows in and staggers the new tickets (`.order-appended`).
 */
const OrdersPage: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  // Only the Admin creates orders (the backend `POST /orders` is Admin-only) — a Driver's agenda has
  // no "Nuevo pedido" affordance (it would only bounce them off the Admin-only create route).
  const canCreate = useHasRole([Role.Admin]);
  const search = useSearch({ from: '/panel/pedidos' }) as OrdersSearch;
  const navigate = useNavigate({ from: '/panel/pedidos' });
  // `view` is the URL INTENT (the pill follows it immediately); `displayedView` is what the body
  // currently shows — it catches up only after the old body's exit completes.
  const view = activeOrdersView(search);
  const [displayedView, setDisplayedView] = useState(view);
  const switching = view !== displayedView;
  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useOrders(displayedView);
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // The lifecycle move awaiting confirmation — the order AND the action the backend offered for it.
  // One dialog serves every kind of move (advance / rewind / cancel); it reads what to ask for from
  // the action itself.
  const [advancing, setAdvancing] = useState<
    { order: OrderListItem; action: OrderAction } | undefined
  >(undefined);

  const fetchedOrders = useMemo(() => data?.orders ?? [], [data]);
  const pagination = data?.pagination;
  // COLD = nothing cached to show for the DISPLAYED view (first visit, or the moment a switch
  // lands on an uncached view) — drives the skeleton.
  const loading = isLoading && !data;
  const hasError = isError && !data;
  const settled = !loading;

  /** Commit a view change to the URL (same route — never through the panel transition). */
  const setView = (next: OrdersView): void => {
    void navigate({
      search: next === 'historial' ? { view: 'historial' } : {},
      viewTransition: false,
    });
  };

  // The skeleton slots stay mounted while loading AND through the resolve (each crossfading in place)
  // — the products page's render-adjust pattern (no synchronous state change inside an effect).
  const [showSkeleton, setShowSkeleton] = useState(loading);
  const [wasLoading, setWasLoading] = useState(loading);
  if (loading !== wasLoading) {
    setWasLoading(loading);
    if (loading) setShowSkeleton(true);
  }

  // A refetch landing on the WARM agenda — creating an order and returning to a cached list — is a
  // two-phase DIFF, not a swap: rows that left shrink out, then the new list commits with the
  // survivors GLIDING to their new places (day/owner headers included, so the space opens instead
  // of the row appearing inside it) while the fresh row fades-rises in. Shared with the products
  // grid — same problem, same answer. Cold loads, view swaps and infinite-scroll appends are
  // excluded here and keep their own machinery.
  // …and it must stay OUT of the view swap's way. `switching` is already false on the very commit
  // where the swap lands with the other view's rows, so excluding it isn't enough: the commit that
  // CHANGES the displayed view is the swap's own entrance, and diffing agenda-vs-history rows there
  // would fight it. That one commit syncs instantly; every later one diffs.
  const [listView, setListView] = useState(displayedView);
  const viewJustLanded = listView !== displayedView;
  if (viewJustLanded) {
    setListView(displayedView);
  }
  const orders = useGridListTransition(
    fetchedOrders,
    settled && !showSkeleton && !switching && !viewJustLanded,
    body,
  );

  // The orders BODY moves LATERALLY on a VIEW SWAP (owner preference — the two views live on a
  // left/right axis): a forward swap travels right-to-left, a backward one mirrors; a plain cold
  // load/reload uses the forward default. This ref carries the side the next body entrance comes
  // from (its exit heads the opposite way).
  const lateralFrom = useRef<'left' | 'right'>('right');

  // The cold-load RESOLVE (products parity, smoothed): the skeleton→ticket crossfade is owned per-slot
  // by each SkeletonFade; the page GROWS in the elements that had no skeleton to become — the surplus
  // rows, the day/owner headers, and the total-count line (`.orders-enter`) — so they ease the rows
  // below them DOWN, and COLLAPSES out the leftover skeleton rows (`.orders-skel-orphan`) so they ease
  // the content up — no jump either way. A LAYOUT effect pins the zero-height start before paint. The
  // skeleton drops once the orphans finish collapsing.
  useLayoutEffect(() => {
    if (loading || !showSkeleton) return;
    growRowsIn(body.current, '.orders-enter');
    void collapseRowsOut(body.current, '.orders-skel-orphan').then(() => setShowSkeleton(false));
  }, [loading, showSkeleton]);

  // Settled-ONLY elements (the total-count line) are withheld during the resolve so they can never
  // flash at a transient position under the departing skeletons; the instant the skeleton clears they
  // mount at their FINAL place and grow in. (A warm load never enters the skeleton, so `was` is false
  // and they simply ride the mount entrance instead.)
  const prevShowSkeleton = useRef(showSkeleton);
  useLayoutEffect(() => {
    const was = prevShowSkeleton.current;
    prevShowSkeleton.current = showSkeleton;
    // A GENTLE fade + a few px rise (NOT a height grow, NOT a full-page-entrance travel): the count
    // sits at the bottom with nothing visible below it, so its space can appear instantly (unseen) and
    // only its content eases in, close to its final spot — no wipe, no "from too far below".
    if (was && !showSkeleton) fadeUpIn(body.current, '.orders-settle-in');
  }, [showSkeleton]);

  // The page-level entrance runs ONCE, on mount: the chrome (lead + switch) rises with the app-wide
  // language — it's the page frame — while the body content (skeleton rows, tickets, or an empty
  // panel alike) slides in from the side, the page's own axis. Every later transition is BODY-scoped.
  const isMounted = useRef(false);
  useLayoutEffect(() => {
    /* v8 ignore next -- StrictMode-only double-invoke guard; an empty-deps effect runs once in prod/tests */
    if (isMounted.current) return;
    isMounted.current = true;
    staggerIn(root.current, '.orders-chrome');
    staggerIn(body.current, '.reveal-item', { from: lateralFrom.current });
  }, []);

  // ── The view swap (a page transition in miniature) ────────────────────────────────────────────
  // URL intent changed → stagger the CURRENT body out (list, skeleton, or empty panel — whatever
  // is up), then flip the displayed view. Flipping back mid-exit cancels the pending flip. The
  // motion is LATERAL and directional, mirroring the segmented pill: moving toward Historial the
  // old body slides out LEFT and the new one enters FROM the right; moving back it mirrors.
  const swapLanded = useRef(false);
  useLayoutEffect(() => {
    if (!switching) return;
    const target = view;
    const forward = ORDERS_VIEWS.indexOf(target) > ORDERS_VIEWS.indexOf(displayedView);
    let cancelled = false;
    void staggerOut(body.current, '.reveal-item', { to: forward ? 'left' : 'right' }).then(() => {
      if (cancelled) return;
      swapLanded.current = true;
      lateralFrom.current = forward ? 'right' : 'left';
      setDisplayedView(target);
    });
    return () => {
      cancelled = true;
    };
  }, [switching, view, displayedView]);

  // …and the entrance half: when `switching` settles, either the flip landed (a fresh body — cached
  // tickets or the uncached view's skeleton rows mounted this commit: full entrance, from the side
  // the motion came from; an uncached view then resolves per-slot via SkeletonFade) or the user
  // flipped back mid-exit (nothing swapped: settle the half-faded body from where it stands).
  const wasSwitching = useRef(false);
  useLayoutEffect(() => {
    const was = wasSwitching.current;
    wasSwitching.current = switching;
    if (!was || switching) return;
    if (swapLanded.current) {
      staggerIn(body.current, '.reveal-item', { from: lateralFrom.current });
    } else {
      staggerIn(body.current, '.reveal-item', { fromCurrent: true });
    }
    lateralFrom.current = 'right';
    swapLanded.current = false;
  }, [switching]);

  // ── Infinite scroll ───────────────────────────────────────────────────────────────────────────
  // An appended page sweeps shimmer rows in under the list; when it lands, the rows past the
  // pre-append count carry `.order-appended` and stagger in. The baseline is STATE (it tags rows
  // during render); clearing it after the stagger fires drops the tags on the next commit without
  // disturbing the running tween (GSAP holds the DOM nodes).
  const [appendBaseline, setAppendBaseline] = useState<number | null>(null);
  const wasAppending = useRef(false);
  useLayoutEffect(() => {
    if (isFetchingNextPage && !wasAppending.current) {
      setAppendBaseline(orders.length);
      staggerIn(root.current, '.append-skel');
    }
    if (!isFetchingNextPage && wasAppending.current) {
      staggerIn(root.current, '.order-appended');
      setAppendBaseline(null);
    }
    wasAppending.current = isFetchingNextPage;
  }, [isFetchingNextPage, orders.length]);

  // A failed next-page fetch keeps the list and offers an inline retry; the sentinel disarms so a
  // dead backend isn't hammered by scrolling.
  const nextPageFailed = isError && Boolean(data) && hasNextPage;
  const sentinelRef = useInfiniteScrollSentinel({
    onReach: () => {
      void fetchNextPage();
    },
    disabled:
      !settled ||
      showSkeleton ||
      switching ||
      hasError ||
      !hasNextPage ||
      isFetchingNextPage ||
      nextPageFailed,
  });

  // The page's motion pair for the panel transition controller.
  usePanelPageMotion(
    useMemo(
      () => ({
        enter: (options) => staggerIn(root.current, '.reveal-item', options),
        exit: () => staggerOut(root.current, '.reveal-item'),
      }),
      [],
    ),
  );

  // Owner bands (agenda = MINE-first / the-rest, from the backend's `isMine`; history = one
  // chronological band), each split into day groups. The list arrives already ordered, so grouping
  // preserves the sequence and the day cascade still reads soonest-first.
  const sections = useMemo(
    () => (displayedView === 'historial' ? groupHistory(orders) : groupAgenda(orders)),
    [orders, displayedView],
  );

  // The FLAT, index-keyed render sequence — the products slot pattern adapted to a grouped ROW list.
  // A cold load (no data) is a run of skeleton order slots; once data lands, day/owner headers
  // interleave and any leftover skeleton slots (data underfilled the skeleton count) trail as
  // orphans. Order slots keep their flat index as their identity, so a slot's SkeletonFade persists
  // across the loading→loaded flip and crossfades in place instead of remounting.
  const rows = useMemo<RenderRow[]>(() => {
    if (orders.length === 0) {
      return showSkeleton
        ? Array.from({ length: SKELETON_ROWS }, (_, index) => ({ kind: 'order' as const, index, order: undefined }))
        : [];
    }
    const out: RenderRow[] = [];
    let index = 0;
    for (const section of sections) {
      if (section.owner !== 'all') {
        out.push({ kind: 'ownerHeader', owner: section.owner, rowKey: `owner-${section.owner}` });
      }
      for (const group of section.days) {
        out.push({ kind: 'dayHeader', group, rowKey: `day-${section.owner}-${group.key}` });
        for (const order of group.orders) {
          out.push({ kind: 'order', index, order });
          index += 1;
        }
      }
    }
    // Leftover skeleton slots (only while resolving, when the data underfilled the skeleton count).
    if (showSkeleton) {
      for (let extra = orders.length; extra < SKELETON_ROWS; extra += 1) {
        out.push({ kind: 'order', index: extra, order: undefined });
      }
    }
    return out;
  }, [sections, orders.length, showSkeleton]);

  // The append choreography tags any row fetched by the latest page — any order past the pre-append
  // baseline. Grouping preserves the flat order, so the appended rows are the tail of `orders` from
  // `appendBaseline` on; an id set keeps the lookup O(1).
  const appendedIds = useMemo(
    () => (appendBaseline === null ? null : new Set(orders.slice(appendBaseline).map((o) => o.id))),
    [orders, appendBaseline],
  );
  const appendedTag = (orderId: number): string =>
    appendedIds?.has(orderId) ? ' order-appended' : '';

  const total = pagination?.total;
  // Empty copy + panel labelling follow the DISPLAYED view (what the body actually shows); the
  // switch's selection follows the intent, like the sidebar pill.
  const emptyKey = displayedView === 'historial' ? 'history' : 'agenda';

  return (
    <div ref={root} className="flex flex-1 flex-col gap-6">
      {/* The chrome never leaves: the view switch must stay reachable in EVERY state (empty,
          error, loading). `orders-chrome` = the mount entrance's vertical-rise scope (the page
          frame); `reveal-item` keeps it in the panel-level exit sweep. */}
      <div className="reveal-item orders-chrome flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-charcoal/55">{t(`${KEY}.lead`)}</p>
        {/* The controls take the WHOLE line once they wrap (`w-full` until `sm`). Without it they
            became a content-width block that `justify-between` then parked at the LEFT — the row
            read as neither aligned nor centred. Full-width instead means the switch sits at the
            start and the action at the end: a real space-between, and the primary action stays on
            the right edge exactly as it is on a wide screen. From `sm` up the group shrinks back to
            its content and the OUTER `justify-between` puts it on the right, beside the lead. */}
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:flex-nowrap">
          <OrdersViewSwitch view={view} onChange={setView} />
          {canCreate && (
            <Button
              size="sm"
              startIcon={<HiOutlinePlus className="size-4" />}
              onClick={() => panelNavigate('/panel/pedidos/nuevo')}
              // `ml-auto` is what keeps the action right-aligned in BOTH wrapped shapes: beside the
              // switch when they share the line, and at the right edge when it drops to its own
              // (where `justify-between` would have left it hanging at the start). It's inert once
              // the container is content-width at `sm`, so the desktop layout is untouched.
              className="ml-auto"
            >
              {t(`${KEY}.newOrder`)}
            </Button>
          )}
        </div>
      </div>
      {/* The loading announcement lives OUTSIDE the row list so it never counts as its first child
          (which would flip the first header's `first:pt-0` on/off as the skeleton comes and goes). */}
      {showSkeleton && (
        <span role="status" aria-label={t(`${KEY}.loading`)} aria-busy className="sr-only" />
      )}
      <div
        ref={body}
        data-order-rows
        id="orders-view-panel"
        role="tabpanel"
        aria-labelledby={`orders-tab-${displayedView}`}
        // GAP-LESS on purpose: each row/header spaces itself with its own padding, so a resolving
        // header/orphan can grow/collapse its HEIGHT to zero and genuinely take no space (a flex gap
        // would reserve space around a zero-height row and reintroduce the jump).
        className="flex flex-1 flex-col"
      >
        {hasError ? (
          <div className="reveal-item">
            <ProductsStatus
              tone="error"
              title={t(`${KEY}.error.title`)}
              description={t(`${KEY}.error.description`)}
              action={
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
              }
            />
          </div>
        ) : rows.length > 0 ? (
          <>
            {rows.map((row) => {
              if (row.kind === 'ownerHeader') {
                // The owner band header (Mis pedidos / El resto) — spacing lives in PADDING (not a
                // margin) so its grow-in height animation carries it. Sweeps in on resolve
                // (`.orders-enter`); on a warm load it rides the mount/swap `.reveal-item` entrance.
                return (
                  <div
                    key={row.rowKey}
                    // Headers join the FLIP too: when a new order opens a new day, the existing
                    // headers GLIDE down to make the room rather than the row appearing inside it.
                    data-flip-id={row.rowKey}
                    className="reveal-item orders-enter flex items-center gap-3 pb-3 pt-5 first:pt-0"
                  >
                    <span className="text-sm font-semibold text-charcoal">
                      {t(`${KEY}.owner.${row.owner}`)}
                    </span>
                    <span aria-hidden className="h-px flex-1 bg-charcoal/10" />
                  </div>
                );
              }
              if (row.kind === 'dayHeader') {
                return (
                  <h2
                    key={row.rowKey}
                    data-flip-id={row.rowKey}
                    className="reveal-item orders-enter pb-3 pt-4 text-xs font-semibold uppercase tracking-wide text-charcoal/45 first:pt-0"
                  >
                    {row.group.kind === 'other'
                      ? formatDayLabel(row.group.date)
                      : t(`${KEY}.day.${row.group.kind}`)}
                  </h2>
                );
              }
              // An order slot. While loading, every slot is a SkeletonFade with no content yet; when
              // the data lands each slot with an order crossfades it in place. A slot that never gets
              // data (the skeleton overfilled the page) becomes a bare orphan and sweeps out; a slot
              // BEYOND the skeleton count is a surplus row with no skeleton to become — it sweeps in.
              const { index, order } = row;
              const isOrphan = !loading && showSkeleton && order === undefined;
              const isSurplus = showSkeleton && order !== undefined && index >= SKELETON_ROWS;
              if (isOrphan) {
                return (
                  <div key={`row-${index}`} className="reveal-item orders-skel-orphan pb-3">
                    <OrderTicketSkeleton />
                  </div>
                );
              }
              return (
                <div
                  key={`row-${index}`}
                  // The slots are index-keyed (so a skeleton crossfades into its ticket in place),
                  // so the ORDER's identity for the FLIP has to travel as data, not as the key.
                  {...(order && { 'data-flip-id': order.id })}
                  className={`reveal-item pb-3${isSurplus ? ' orders-enter' : ''}${order ? appendedTag(order.id) : ''}`}
                >
                  <SkeletonFade
                    loading={loading}
                    skeleton={<OrderTicketSkeleton />}
                    className="block"
                    contentClassName="block"
                    animateSize="height"
                    revealDelaySeconds={rowRevealDelay}
                  >
                    {order && (
                      <OrderTicket
                        order={order}
                        // Opening rides the PANEL transition (the list staggers out, the detail
                        // plays its own entrance) — never a raw router jump.
                        onOpen={(target) => panelNavigate(`/panel/pedidos/${target.id}`)}
                        onAdvance={(target, action) => setAdvancing({ order: target, action })}
                      />
                    )}
                  </SkeletonFade>
                </div>
              );
            })}
            {isFetchingNextPage && (
              <div aria-hidden className="flex flex-col gap-3">
                {Array.from({ length: APPEND_SKELETONS }).map((_, index) => (
                  <div key={`append-${index}`} className="reveal-item append-skel">
                    <OrderTicketSkeleton />
                  </div>
                ))}
              </div>
            )}
            {nextPageFailed && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-charcoal/55">{t(`${KEY}.nextPage.error`)}</p>
                <Button
                  variant="soft"
                  color={SECONDARY_COLOR}
                  size="sm"
                  loading={isFetchingNextPage}
                  startIcon={<HiOutlineArrowPath className="size-4" />}
                  onClick={() => void fetchNextPage()}
                >
                  {t(`${KEY}.nextPage.retry`)}
                </Button>
              </div>
            )}
            {total !== undefined && !showSkeleton && (
              // The total is rendered ONLY once the skeleton has FULLY resolved (`!showSkeleton`), so
              // it never flashes at a transient position under the departing orphans; it then grows
              // into its final place via the settle effect (`.orders-settle-in`). On a warm load it
              // rides the mount/swap `.reveal-item` entrance like everything else.
              <p
                aria-live="polite"
                className="reveal-item orders-settle-in pt-2 text-center text-xs text-charcoal/45"
              >
                {orders.length < total
                  ? t(`${KEY}.count.partial`, { shown: orders.length, total })
                  : t(`${KEY}.count.all`, { count: total })}
              </p>
            )}
            <div ref={sentinelRef} aria-hidden className="h-px" />
          </>
        ) : (
          // Reached only with NO rows and NO error — and `rows` is empty exactly when the loaded
          // list is empty (a cold load always has skeleton rows), so this is always the empty state.
          <div className="reveal-item">
            <ProductsStatus
              tone="empty"
              title={t(`${KEY}.empty.${emptyKey}.title`)}
              description={t(`${KEY}.empty.${emptyKey}.description`)}
            />
          </div>
        )}
      </div>
      {/* The one confirm dialog for every lifecycle move. It asks for photos or a reason only when
          the offered action declares it, and refetches both views on success (an advance can move a
          row from the agenda into the history). */}
      <OrderAdvanceModal
        order={advancing?.order}
        action={advancing?.action}
        onClose={() => setAdvancing(undefined)}
      />
    </div>
  );
};

export default OrdersPage;
