import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowPath } from 'react-icons/hi2';
import Button from '@components/Button';
import { useInfiniteScrollSentinel } from '@hooks/useInfiniteScrollSentinel';
import { staggerIn, staggerOut } from '../pageMotion';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
// Shared status panel (empty/error family). Promote to @components when a third section needs it.
import ProductsStatus from '../products/ProductsStatus';
import { formatDayLabel, groupOrdersByDay } from './orderDayGroups';
import OrdersViewSwitch from './OrdersViewSwitch';
import OrderTicket from './OrderTicket';
import OrderTicketSkeleton from './OrderTicketSkeleton';
import { ORDERS_VIEWS, activeOrdersView, type OrdersSearch, type OrdersView } from './ordersSearch';
import { useOrders } from './useOrders';

const KEY = 'modules.panel.orders';
const SECONDARY_COLOR = '#262626';

// The cold-load skeleton: two believable day groups' worth of ticket rows — enough to read as
// "an agenda is coming" without filling the screen with shimmer.
const SKELETON_GROUPS: readonly number[] = [3, 2];
// How many shimmer rows an appending page shows — a list reveals ~this many rows near the
// sentinel; the real rows stagger in when the page lands.
const APPEND_SKELETONS = 4;
const SHIMMER = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

/**
 * The orders screen (`/panel/pedidos`) — Epic-2's agenda. **Admin only** for now (the route guard
 * mirrors the backend's Admin-only reads; Client/Driver views arrive with their own backend
 * slices). Two views behind an accessible segmented control, held in the URL (`?view=historial`):
 * the **agenda** (every order that is still work, grouped under Hoy/Mañana/date headers, soonest
 * first) and the **history** (finished/cancelled, newest first). The list is an infinite scroll
 * like products, deliberately WITHOUT empty-day placeholders — a rentals agenda is sparse, and the
 * temporal-grid view belongs to the future dashboard calendar.
 *
 * Choreography follows the panel doctrine — nothing pops. A **view switch is a page transition
 * in miniature**: the displayed view is DECOUPLED from the URL intent — the current body (list,
 * skeleton, or empty panel alike) staggers OUT first, then the displayed view flips and the new
 * body (cached tickets, or the skeleton of an uncached fetch) staggers IN — while the segmented
 * control's pill glides in step. Flipping back mid-exit cancels and settles the body from the
 * current frame (the panel's latest-intent-wins semantics). The cold load shows a skeleton agenda
 * that sweeps out before the resolved body staggers in; an appended page sweeps shimmer rows in
 * and staggers the new tickets (`.order-appended`) when they land.
 */
const OrdersPage: React.FC = () => {
  const { t } = useTranslation();
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

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const pagination = data?.pagination;
  // COLD = nothing cached to show for the DISPLAYED view (first visit, or the moment a switch
  // lands on an uncached view) — drives the skeleton.
  const loading = isLoading && !data;
  const hasError = isError && !data;
  const empty = orders.length === 0;
  const settled = !loading;

  /** Commit a view change to the URL (same route — never through the panel transition). */
  const setView = (next: OrdersView): void => {
    void navigate({
      search: next === 'historial' ? { view: 'historial' } : {},
      viewTransition: false,
    });
  };

  // The skeleton stays mounted while loading AND through its exit sweep after loading ends
  // (the products page's render-adjust pattern — no synchronous state change inside an effect).
  const [showSkeleton, setShowSkeleton] = useState(loading);
  const [wasLoading, setWasLoading] = useState(loading);
  if (loading !== wasLoading) {
    setWasLoading(loading);
    if (loading) setShowSkeleton(true);
  }

  // Loading resolved → sweep the skeleton out, THEN mount the real body (which staggers in below).
  useEffect(() => {
    if (loading || !showSkeleton) return;
    void staggerOut(root.current, '.orders-skel').then(() => setShowSkeleton(false));
  }, [loading, showSkeleton]);

  // The page-level entrance runs ONCE, on mount (whatever state it lands in). Every later
  // transition is BODY-scoped — re-staggering the root would re-animate the chrome (the lead +
  // the switch), the exact same-elements-re-entering glitch the header title fix killed.
  const isMounted = useRef(false);
  useLayoutEffect(() => {
    /* v8 ignore next -- StrictMode-only double-invoke guard; an empty-deps effect runs once in prod/tests */
    if (isMounted.current) return;
    isMounted.current = true;
    staggerIn(root.current, '.reveal-item');
  }, []);

  // Body entrance when the skeleton finished sweeping — the resolved content mounted this commit.
  const prevShowSkeleton = useRef(showSkeleton);
  useLayoutEffect(() => {
    const was = prevShowSkeleton.current;
    prevShowSkeleton.current = showSkeleton;
    if (was && !showSkeleton) staggerIn(body.current, '.reveal-item');
  }, [showSkeleton]);

  // ── The view swap (a page transition in miniature) ────────────────────────────────────────────
  // URL intent changed → stagger the CURRENT body out (list, skeleton, or empty panel — whatever
  // is up), then flip the displayed view. Flipping back mid-exit cancels the pending flip. The
  // motion is LATERAL and directional, mirroring the segmented pill: moving toward Historial the
  // old body slides out LEFT and the new one enters FROM the right; moving back it mirrors —
  // the two views sit side by side, so the content travels the way the selection does.
  const swapLanded = useRef(false);
  const swapEnterFrom = useRef<'left' | 'right'>('right');
  useLayoutEffect(() => {
    if (!switching) return;
    const target = view;
    const forward = ORDERS_VIEWS.indexOf(target) > ORDERS_VIEWS.indexOf(displayedView);
    let cancelled = false;
    void staggerOut(body.current, '.reveal-item', { to: forward ? 'left' : 'right' }).then(() => {
      if (cancelled) return;
      swapLanded.current = true;
      swapEnterFrom.current = forward ? 'right' : 'left';
      setDisplayedView(target);
    });
    return () => {
      cancelled = true;
    };
  }, [switching, view, displayedView]);

  // …and the entrance half: when `switching` settles, either the flip landed (a fresh body —
  // cached tickets or the uncached view's skeleton — mounted this commit: full entrance, from the
  // side the motion came from) or the user flipped back mid-exit (nothing swapped: settle the
  // half-faded body from where it stands).
  const wasSwitching = useRef(false);
  useLayoutEffect(() => {
    const was = wasSwitching.current;
    wasSwitching.current = switching;
    if (!was || switching) return;
    staggerIn(
      body.current,
      '.reveal-item',
      swapLanded.current ? { from: swapEnterFrom.current } : { fromCurrent: true },
    );
    swapLanded.current = false;
  }, [switching]);

  // ── Infinite scroll ───────────────────────────────────────────────────────────────────────────
  // An appended page sweeps shimmer rows in under the list; when it lands, the rows past the
  // pre-append count (and any new day headers) carry `.order-appended` and stagger in. The
  // baseline is STATE (it tags rows during render); clearing it after the stagger fires drops the
  // tags on the next commit without disturbing the running tween (GSAP holds the DOM nodes).
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

  // Day groups with each group's flat start index — the append choreography tags rows (and any
  // new day header) whose flat index is past the pre-append baseline. (Quadratic over the group
  // count, trivially small; the React Compiler forbids a running-total reassignment here.)
  const groups = useMemo(
    () =>
      groupOrdersByDay(orders).map((group, index, all) => ({
        ...group,
        startIndex: all.slice(0, index).reduce((sum, prior) => sum + prior.orders.length, 0),
      })),
    [orders],
  );
  const appendedTag = (flatIndex: number): string =>
    appendBaseline !== null && flatIndex >= appendBaseline ? ' order-appended' : '';

  const total = pagination?.total;
  // Empty copy + panel labelling follow the DISPLAYED view (what the body actually shows); the
  // switch's selection follows the intent, like the sidebar pill.
  const emptyKey = displayedView === 'historial' ? 'history' : 'agenda';

  return (
    <div ref={root} className="flex flex-1 flex-col gap-6">
      {/* The chrome never leaves: the view switch must stay reachable in EVERY state (empty,
          error, loading) — unlike products, where a truly-empty catalog stands alone. */}
      <div className="reveal-item flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-charcoal/55">{t(`${KEY}.lead`)}</p>
        <OrdersViewSwitch view={view} onChange={setView} />
      </div>
      <div
        ref={body}
        id="orders-view-panel"
        role="tabpanel"
        aria-labelledby={`orders-tab-${displayedView}`}
        className="flex flex-1 flex-col gap-6"
      >
        {showSkeleton ? (
          <div
            role="status"
            aria-label={t(`${KEY}.loading`)}
            aria-busy
            className="flex flex-col gap-6"
          >
            {SKELETON_GROUPS.map((rows, groupIndex) => (
              <div key={`skel-group-${groupIndex}`} className="flex flex-col gap-3">
                <div aria-hidden className={`reveal-item orders-skel h-3 w-24 ${SHIMMER}`} />
                {Array.from({ length: rows }).map((_, index) => (
                  <div key={`skel-${groupIndex}-${index}`} className="reveal-item orders-skel">
                    <OrderTicketSkeleton />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : hasError ? (
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
        ) : empty ? (
          <ProductsStatus
            tone="empty"
            title={t(`${KEY}.empty.${emptyKey}.title`)}
            description={t(`${KEY}.empty.${emptyKey}.description`)}
          />
        ) : (
          <>
            {groups.map((group) => (
              <section key={group.key} className="flex flex-col gap-3">
                <h2
                  className={`reveal-item${appendedTag(group.startIndex)} text-xs font-semibold uppercase tracking-wide text-charcoal/45`}
                >
                  {group.kind === 'other' ? formatDayLabel(group.date) : t(`${KEY}.day.${group.kind}`)}
                </h2>
                {group.orders.map((order, index) => (
                  <div
                    key={order.id}
                    className={`reveal-item${appendedTag(group.startIndex + index)}`}
                  >
                    <OrderTicket order={order} />
                  </div>
                ))}
              </section>
            ))}
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
            {total !== undefined && (
              <p aria-live="polite" className="reveal-item text-center text-xs text-charcoal/45">
                {orders.length < total
                  ? t(`${KEY}.count.partial`, { shown: orders.length, total })
                  : t(`${KEY}.count.all`, { count: total })}
              </p>
            )}
            <div ref={sentinelRef} aria-hidden className="h-px" />
          </>
        )}
      </div>
    </div>
  );
};

export default OrdersPage;
