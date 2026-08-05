import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowPath,
  HiOutlineBanknotes,
  HiOutlineClipboardDocumentList,
  HiOutlineExclamationTriangle,
  HiOutlinePlus,
  HiOutlineReceiptPercent,
  HiOutlineTruck,
  HiOutlineXCircle,
} from 'react-icons/hi2';
import Button from '@components/Button';
import useBreakpoint from '@hooks/useBreakpoint';
import BarChart from '@components/charts/BarChart';
import DonutChart, { type DonutSlice } from '@components/charts/DonutChart';
import { statusTone } from '../orders/statusTone';
import { SECTION_REVEAL_STEP, staggerIn, staggerInNested, staggerOut } from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import ProductsStatus from '../products/ProductsStatus';
import SectionReveal from '../products/SectionReveal';
import OrderAdvanceModal from '../orders/OrderAdvanceModal';
import OrderPaymentModal from '../orders/OrderPaymentModal';
import type { OrderAction } from '../orders/order.types';
import type { UpNextItem } from './dashboard.types';
import { formatMonthLabel, formatMoney, freshnessLabel, secondsSince } from './dashboardFormat';
import { ChartSkeleton, ListSkeleton, StatsSkeleton, UpNextSkeleton } from './DashboardSkeleton';
import StatCard from './StatCard';
import UpNextCard from './UpNextCard';
import { useDashboard } from './useDashboard';

const KEY = 'modules.panel.dashboard';
const SECONDARY_COLOR = '#262626';

/** How often the "actualizado hace…" line re-renders. The DATA refreshes on its own schedule
 *  (`useDashboard`); this only keeps the age honest between fetches. Five seconds because the label
 *  is now second-resolution — at the old 30s it would have skipped most of the values it can show. */
const AGE_TICK_MS = 5_000;

/** The palette the donut borrows from the status chips, so a status wears the SAME colour on the
 *  ring as it does on every ticket. Falls back to neutral for an unknown token, exactly like
 *  `statusTone` does. */
const sliceColor = (colorKey: string | undefined): string => {
  // `statusTone` returns background+text classes for a chip; the ring wants a text colour it can
  // inherit through `currentColor`, so the text half is extracted and the background dropped.
  const tone = statusTone(colorKey);
  /* v8 ignore next -- every tone in the palette carries a `text-` class, including the neutral
     fallback; the `??` guards a palette entry that omits one */
  return tone.split(' ').find((cls) => cls.startsWith('text-')) ?? 'text-charcoal/30';
};

/**
 * The admin home screen (`/panel/inicio`) — the panel's front door.
 *
 * Three questions, in the order an owner actually asks them:
 *
 * 1. **What do I do next?** The three orders whose next event is soonest, each with the one action
 *    that moves it forward and a button that hands the address to the driver's maps app. This is the
 *    only part of the screen you can act on, so it leads and it is the widest.
 * 2. **How is today?** Deliveries, collections, what is late, what is open.
 * 3. **How is the business?** This month against last, what is still owed, a year of revenue, what
 *    is actually going out of the warehouse, and where the live orders are sitting.
 *
 * It is ONE request (`useDashboard`) — every figure is a snapshot of the same instant, so the screen
 * can never show a total from one moment beside a counter from another.
 *
 * **Acting here updates here.** The quick action opens the very same `OrderAdvanceModal` the agenda
 * uses, and its mutation cancels the dashboard's in-flight read before invalidating it — otherwise a
 * poll issued a moment before the tap could land after it and paint the pre-move queue back, which
 * reads as the app undoing the admin's work.
 */
const DashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const { isMobile } = useBreakpoint();
  const root = useRef<HTMLDivElement>(null);
  const { data, isLoading, isError, refetch } = useDashboard();
  const [pending, setPending] = useState<{ item: UpNextItem; action: OrderAction } | undefined>(
    undefined,
  );
  const [payingOrder, setPayingOrder] = useState<UpNextItem | undefined>(undefined);

  // The freshness line ticks on its own so "hace 3 min" doesn't sit frozen at "hace 0 min" between
  // fetches. It is display-only — nothing re-reads because of it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // The page's own entrance/exit, registered with the panel's transition controller. Nested wave:
  // each section card arrives and its rows fill in just behind it, anchored to that card's delay —
  // the whole page reads as ONE cascade.
  const enter = useCallback(
    (options?: { fromCurrent?: boolean }) =>
      staggerInNested(root.current, '.reveal-block', '.card-item', options),
    [],
  );
  const exit = useCallback(() => staggerOut(root.current, '.reveal-block'), []);
  usePanelPageMotion({ enter, exit });
  useLayoutEffect(() => {
    staggerIn(root.current, '.reveal-block');
  }, []);

  if (isError) {
    return (
      <div ref={root} className="flex flex-col gap-6">
        <div className="reveal-block">
          <ProductsStatus
            tone="error"
            title={t(`${KEY}.loadError.title`)}
            description={t(`${KEY}.loadError.description`)}
            action={
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                startIcon={<HiOutlineArrowPath className="size-4" />}
                onClick={() => void refetch()}
              >
                {t(`${KEY}.loadError.retry`)}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const currency = data?.currency.symbol ?? '';
  const money = (amount: number) => formatMoney(currency, amount);
  const loading = isLoading || !data;

  const statusSlices: DonutSlice[] = (data?.statusSplit ?? []).map((slice) => ({
    label: slice.name,
    value: slice.count,
    colorClass: sliceColor(slice.colorKey),
  }));
  const topMax = Math.max(1, ...(data?.topProducts ?? []).map((product) => product.quantity));

  return (
    <div ref={root} className="flex flex-col gap-6">
      {/* ── 1. What do I do next ─────────────────────────────────────────────────────────── */}
      <section className="reveal-block flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-charcoal">{t(`${KEY}.upNext.title`)}</h2>
            <p className="text-xs text-charcoal/55">{t(`${KEY}.upNext.description`)}</p>
          </div>
          {data && (
            <p className="shrink-0 text-[11px] tabular-nums text-charcoal/40">
              {(() => {
                const age = freshnessLabel(secondsSince(data.generatedAt, now));
                return t(`${KEY}.updated.${age.key}`, { count: age.count });
              })()}
            </p>
          )}
        </div>

        <SectionReveal loading={loading} skeleton={<UpNextSkeleton />}>
          {data && data.upNext.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-3">
              {data.upNext.map((item, index) => (
                <div key={`${item.id}-${item.event.kind}`} className="card-item">
                  <UpNextCard
                    item={item}
                    rank={index}
                    onOpen={(order) => panelNavigate(`/panel/pedidos/${order.id}`)}
                    onAdvance={(order, action) => setPending({ item: order, action })}
                    onPay={setPayingOrder}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="card-item">
              <ProductsStatus
                tone="empty"
                title={t(`${KEY}.upNext.emptyTitle`)}
                description={t(`${KEY}.upNext.emptyDescription`)}
                action={
                  <Button
                    color={SECONDARY_COLOR}
                    startIcon={<HiOutlinePlus className="size-4" />}
                    onClick={() => panelNavigate('/panel/pedidos/nuevo')}
                  >
                    {t(`${KEY}.upNext.emptyAction`)}
                  </Button>
                }
              />
            </div>
          )}
        </SectionReveal>
      </section>

      {/* ── 2. Today ─────────────────────────────────────────────────────────────────────── */}
      <section className="reveal-block flex flex-col gap-3">
        <h2 className="text-base font-bold text-charcoal">{t(`${KEY}.today.title`)}</h2>
        <SectionReveal loading={loading} skeleton={<StatsSkeleton />} delaySeconds={SECTION_REVEAL_STEP}>
          {data && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={t(`${KEY}.today.deliveries`)}
                value={String(data.today.deliveries)}
                icon={HiOutlineTruck}
              />
              <StatCard
                label={t(`${KEY}.today.collections`)}
                value={String(data.today.collections)}
                icon={HiOutlineClipboardDocumentList}
              />
              <StatCard
                label={t(`${KEY}.today.overdue`)}
                value={String(data.today.overdue)}
                icon={HiOutlineExclamationTriangle}
                hint={t(`${KEY}.today.overdueHint`)}
              />
              <StatCard
                label={t(`${KEY}.today.active`)}
                value={String(data.today.active)}
                icon={HiOutlineReceiptPercent}
                hint={t(`${KEY}.today.activeHint`)}
              />
            </div>
          )}
        </SectionReveal>
      </section>

      {/* ── 3. The business ──────────────────────────────────────────────────────────────── */}
      <section className="reveal-block flex flex-col gap-3">
        <h2 className="text-base font-bold text-charcoal">{t(`${KEY}.month.title`)}</h2>
        <SectionReveal
          loading={loading}
          skeleton={<StatsSkeleton />}
          delaySeconds={SECTION_REVEAL_STEP * 2}
        >
          {data && (
            // FIVE cards here (revenue, orders, ticket, outstanding, cancelled): 5-up only on the
            // widest screens, 3-up below — never a single orphan on its own row.
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
              <StatCard
                label={t(`${KEY}.month.revenue`)}
                value={money(data.month.revenue.current)}
                icon={HiOutlineBanknotes}
                stat={data.month.revenue}
                hint={t(`${KEY}.month.previous`, { value: money(data.month.revenue.previous) })}
              />
              <StatCard
                label={t(`${KEY}.month.orders`)}
                value={String(data.month.orders.current)}
                icon={HiOutlineClipboardDocumentList}
                stat={data.month.orders}
                hint={t(`${KEY}.month.previous`, { value: String(data.month.orders.previous) })}
              />
              <StatCard
                label={t(`${KEY}.month.averageOrder`)}
                value={money(data.month.averageOrder.current)}
                icon={HiOutlineReceiptPercent}
                stat={data.month.averageOrder}
              />
              <StatCard
                label={t(`${KEY}.month.outstanding`)}
                value={money(data.outstanding.amount)}
                icon={HiOutlineBanknotes}
                hint={t(`${KEY}.month.outstandingHint`, { count: data.outstanding.orders })}
              />
              {/* Cancellations are excluded from every other figure here (they are not revenue and
                  not work in progress), which left them invisible on the whole screen. */}
              <StatCard
                label={t(`${KEY}.month.cancelled`)}
                value={String(data.month.cancelled.current)}
                icon={HiOutlineXCircle}
                stat={data.month.cancelled}
                hint={t(`${KEY}.month.previous`, { value: String(data.month.cancelled.previous) })}
              />
            </div>
          )}
        </SectionReveal>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="reveal-block flex flex-col gap-5 rounded-card bg-white p-4 ring-1 ring-black/[0.04] sm:p-5">
          <div>
            <h2 className="text-base font-bold text-charcoal">{t(`${KEY}.trend.title`)}</h2>
            <p className="text-xs text-charcoal/55">{t(`${KEY}.trend.description`)}</p>
          </div>
          <SectionReveal
            loading={loading}
            skeleton={<ChartSkeleton />}
            delaySeconds={SECTION_REVEAL_STEP * 3}
          >
            {data && (
              <div className="card-item">
                <BarChart
                  highlightLast
                  data={data.revenueTrend.map((point) => ({
                    label: formatMonthLabel(point.month),
                    value: point.revenue,
                    meta: point.orders,
                  }))}
                  formatValue={money}
                  ariaLabel={t(`${KEY}.trend.title`)}
                  // The axis counts money, so it says so ONCE — never a symbol on every tick.
                  unit={data.currency.symbol}
                  // Twelve short month labels fit comfortably on a card this wide, and a chart that
                  // hides half its axis makes the reader count bars to find a month. A phone has no
                  // such room, so there it keeps thinning. `isMobile` is briefly undefined
                  // pre-effect — treat that as the narrow case, like the agenda ticket does.
                  maxLabels={isMobile === false ? 12 : 6}
                />
              </div>
            )}
          </SectionReveal>
        </section>

        <section className="reveal-block flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-black/[0.04] sm:p-5">
          <div>
            <h2 className="text-base font-bold text-charcoal">{t(`${KEY}.statusSplit.title`)}</h2>
            <p className="text-xs text-charcoal/55">{t(`${KEY}.statusSplit.description`)}</p>
          </div>
          <SectionReveal
            loading={loading}
            skeleton={<ChartSkeleton />}
            delaySeconds={SECTION_REVEAL_STEP * 3}
          >
            {data &&
              (statusSlices.length > 0 ? (
                <div className="card-item">
                  <DonutChart
                    slices={statusSlices}
                    centerValue={String(data.today.active)}
                    centerLabel={t(`${KEY}.statusSplit.centerLabel`)}
                    ariaLabel={t(`${KEY}.statusSplit.title`)}
                  />
                </div>
              ) : (
                <p className="card-item text-sm text-charcoal/45">{t(`${KEY}.statusSplit.empty`)}</p>
              ))}
          </SectionReveal>
        </section>
      </div>

      <section className="reveal-block flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-black/[0.04] sm:p-5">
        <div>
          <h2 className="text-base font-bold text-charcoal">{t(`${KEY}.topProducts.title`)}</h2>
          <p className="text-xs text-charcoal/55">{t(`${KEY}.topProducts.description`)}</p>
        </div>
        <SectionReveal
          loading={loading}
          skeleton={<ListSkeleton />}
          delaySeconds={SECTION_REVEAL_STEP * 4}
        >
          {data &&
            (data.topProducts.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {data.topProducts.map((product) => (
                  <li key={product.productId} className="card-item flex min-w-0 items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium text-charcoal">
                          {product.name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-charcoal/55">
                          {t(`${KEY}.topProducts.units`, { count: product.quantity })} ·{' '}
                          {money(product.revenue)}
                        </span>
                      </span>
                      {/* A proportional bar, so the ranking is legible before any number is read. */}
                      <span
                        aria-hidden
                        className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-charcoal/[0.06]"
                      >
                        {/* Width is transitioned so a refresh ADAPTS the bar to its new share
                            instead of snapping — the same rule the charts follow. */}
                        <span
                          className="block h-full rounded-full bg-gradient-to-r from-cream to-blossom transition-[width] duration-500 ease-[var(--ease-settle)] motion-reduce:transition-none"
                          style={{ width: `${Math.round((product.quantity / topMax) * 100)}%` }}
                        />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="card-item text-sm text-charcoal/45">{t(`${KEY}.topProducts.empty`)}</p>
            ))}
        </SectionReveal>
      </section>

      {/* The SAME dialog the agenda opens — one confirm flow for every lifecycle move in the app. */}
      <OrderAdvanceModal
        order={pending?.item}
        action={pending?.action}
        onClose={() => setPending(undefined)}
      />
      {/* The same payment dialog the agenda and the detail open — one flow for recording money. */}
      <OrderPaymentModal order={payingOrder} onClose={() => setPayingOrder(undefined)} />
    </div>
  );
};

export default DashboardPage;
