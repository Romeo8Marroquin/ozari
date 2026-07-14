import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowPath, HiOutlinePlus, HiOutlineXMark } from 'react-icons/hi2';
import Button from '@components/Button';
import RoleGate from '@components/RoleGate';
import SkeletonFade from '@components/SkeletonFade';
import { Role } from '@constants/Roles';
import { useInfiniteScrollSentinel } from '@hooks/useInfiniteScrollSentinel';
import { staggerIn, staggerOut } from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import ProductCard from './ProductCard';
import ProductCardSkeleton from './ProductCardSkeleton';
import ProductsFilterBar from './ProductsFilterBar';
import ProductsStatus from './ProductsStatus';
import { hasActiveFilters, type ProductListSearch } from './productListSearch';
import { PRODUCTS_PAGE_SIZE, useProducts } from './useProducts';

const KEY = 'modules.panel.products';

// Responsive grid: two columns on phones up to five on ultrawide. Deliberately FEWER columns than
// the space could fit — the tiles are the product photography, and desktop was rendering them too
// small to read; larger tiles carry the info (and the in-place hover transform) comfortably.
// Skeleton and real cards share this exact layout so each card lands where its skeleton stood.
const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5';

// Enough skeletons to fill several rows while the first page loads; any extras beyond the real count
// simply sweep out (they never mounted a card). Kept a constant — dynamic viewport-fill is a future
// refinement, not needed for a calm first paint.
const SKELETON_COUNT = 12;
const SECONDARY_COLOR = '#262626';

/**
 * The catalog screen (`/panel/productos`) — EPIC-1's first real product view. Open to **every**
 * authenticated role; the backend role-projects the fields (see {@link useProducts}), so the same grid
 * serves Client, Employee, and Admin, and only Admin sees the "add" affordance (a UX layer — the `403`
 * is the real guard).
 *
 * The list is an **infinite scroll**: a sentinel under the grid appends the next page as the user
 * approaches the bottom, and **filters live in the URL** (`useSearch`) — search / category / type /
 * (Employee+) availability — so a filtered view survives refresh and can be shared.
 *
 * The whole screen is choreographed so no state ever "pops". Three skeleton moments share the same
 * language: the COLD load is a **pairwise hand-off** over stable grid SLOTS (the SkeletonFade
 * doctrine, per cell) — a skeleton that received data crossfades into its card in place, orphans
 * sweep out, surplus cards sweep in; an **appended page** mounts its own batch of skeleton slots
 * (swept in) that crossfade into cards when the page lands; a **filter change** keeps the current
 * grid dimmed (`keepPreviousData`) and re-staggers the body when the new results land. Empty and
 * error resolutions still sweep the skeleton grid out before their panel staggers in — with one
 * split: a **filtered** empty result keeps the header + filter bar (so the filters can be cleared),
 * while the true-empty catalog and the cold error stand alone, exactly as before.
 */
const ProductsPage: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const search = useSearch({ from: '/panel/productos' });
  const navigate = useNavigate({ from: '/panel/productos' });
  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPlaceholderData,
  } = useProducts(search);
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const filtered = hasActiveFilters(search);
  const products = useMemo(() => data?.products ?? [], [data]);
  const pagination = data?.pagination;
  // Only a COLD state (nothing cached to show) drives the skeleton / error panel; a background refetch
  // (and a filter change riding `keepPreviousData`) keeps the current grid on screen instead of
  // flashing back to skeletons.
  const loading = isLoading && !data;
  const hasError = isError && !data;

  /** Commit a new filter state to the URL (never through the panel transition — same route). */
  const applyFilters = useCallback(
    (next: ProductListSearch, options?: { replace?: boolean }) => {
      void navigate({ search: next, replace: options?.replace ?? false, viewTransition: false });
    },
    [navigate],
  );

  // The skeleton stays mounted while loading AND through its exit sweep after loading ends, so the
  // real content mounts into its place rather than popping. Re-arming when we RE-ENTER loading (a cold
  // reload) uses React's "adjust state during render" pattern (like SkeletonFade) — not an effect —
  // which keeps the synchronous state change out of the effect body.
  const [showSkeleton, setShowSkeleton] = useState(loading);
  const [wasLoading, setWasLoading] = useState(loading);
  if (loading !== wasLoading) {
    setWasLoading(loading);
    if (loading) setShowSkeleton(true);
  }

  // Once loading finishes, resolve the hand-off. POPULATED: the per-cell crossfades run on their
  // own (SkeletonFade), the header + surplus cards sweep in (`.grid-enter`), and only the ORPHAN
  // skeletons sweep out before the skeleton phase ends. EMPTY/ERROR: the skeleton grid sweeps out,
  // then the panel staggers in — and when the chrome (header + filter bar) must ALSO leave (it is
  // only tagged `product-skel` when unfiltered; a filtered resolution keeps it), a filtered cold
  // error additionally sweeps the `.products-chrome` items. State changes land in the async
  // completions, never synchronously in the effect body.
  useEffect(() => {
    if (loading || !showSkeleton) return;
    if (!hasError && products.length > 0) {
      staggerIn(root.current, '.grid-enter');
      void staggerOut(root.current, '.product-skel-orphan').then(() => setShowSkeleton(false));
      return;
    }
    const sweep = hasError && filtered ? '.product-skel, .products-chrome' : '.product-skel';
    void staggerOut(root.current, sweep).then(() => setShowSkeleton(false));
  }, [loading, showSkeleton, hasError, products.length, filtered]);

  const empty = products.length === 0;
  const settled = !loading && !showSkeleton;
  // A filtered empty result is NOT the empty catalog: the chrome stays so the filters can be
  // cleared, and the panel says "no matches", not "start your catalog".
  const filteredEmpty = settled && !hasError && empty && filtered;
  const showChrome = showSkeleton || (!hasError && (!empty || filteredEmpty));

  // Entrances that are NOT part of the pairwise hand-off and happen with the chrome DOWN (or on the
  // page's own arrival): the mount (whatever state it lands in), a re-entered cold load, the
  // standalone empty/error panels once the skeleton finished sweeping, and the grid arriving
  // straight from a settled standalone panel (error → successful retry). Chrome-persistent
  // transitions (filter interactions) are the body effect's job below — re-staggering the whole
  // root would flash the header/filter bar that never moved.
  const isMounted = useRef(false);
  const wasPopulated = useRef(false);
  const wasChromeUp = useRef(false);
  useLayoutEffect(() => {
    const firstRender = !isMounted.current;
    isMounted.current = true;
    const populated = !loading && !hasError && !empty;
    const arrivedFromPanel = populated && !wasPopulated.current && !showSkeleton && !wasChromeUp.current;
    wasPopulated.current = populated;
    wasChromeUp.current = showChrome;
    if (firstRender || loading || (settled && !populated && !showChrome) || arrivedFromPanel) {
      staggerIn(root.current, '.reveal-item');
    }
  }, [loading, showSkeleton, hasError, empty, settled, showChrome]);

  // Chrome-persistent BODY transitions (the header + filter bar hold still; only the area under
  // them changes): grid ⇄ filtered-empty swaps stagger the incoming body in, and a resolved filter
  // change (`keepPreviousData` placeholder → fresh results) re-staggers the new cards. The first
  // settle is excluded — the cold hand-off (grid) or the skeleton-sweep entrance above owns it —
  // EXCEPT filtered-empty, whose panel mounts only after the sweep and needs its own entrance.
  const bodyKey = !settled || hasError ? null : !empty ? 'grid' : filteredEmpty ? 'filteredEmpty' : null;
  const prevBodyKey = useRef<typeof bodyKey>(null);
  const wasPlaceholder = useRef(false);
  useLayoutEffect(() => {
    const previous = prevBodyKey.current;
    prevBodyKey.current = bodyKey;
    const placeholderResolved = wasPlaceholder.current && !isPlaceholderData;
    wasPlaceholder.current = isPlaceholderData;
    if (bodyKey === null) return;
    if (previous === null) {
      if (bodyKey === 'filteredEmpty') staggerIn(body.current, '.reveal-item');
      return;
    }
    if (previous !== bodyKey || (placeholderResolved && bodyKey === 'grid')) {
      staggerIn(body.current, '.reveal-item');
    }
  }, [bodyKey, isPlaceholderData]);

  // ── Infinite scroll ─────────────────────────────────────────────────────────────────────────────
  // The appended page repeats the cold load's language in miniature: a batch of skeleton slots
  // (exactly as many as remain, capped at a page) sweeps in when the fetch starts, and each
  // crossfades into its card in place when the page lands (the slots are keyed by index, so the
  // SkeletonFade instances persist across the flip). If the server returns fewer rows than
  // announced (the total changed mid-scroll), the unfilled slots simply unmount — a rare edge we
  // accept over orphan choreography here.
  const total = pagination?.total;
  const appendCount = isFetchingNextPage
    ? Math.min(total !== undefined ? Math.max(total - products.length, 1) : PRODUCTS_PAGE_SIZE, PRODUCTS_PAGE_SIZE)
    : 0;

  const wasAppending = useRef(false);
  useLayoutEffect(() => {
    if (isFetchingNextPage && !wasAppending.current) staggerIn(root.current, '.append-skel');
    wasAppending.current = isFetchingNextPage;
  }, [isFetchingNextPage]);

  // A failed next-page fetch keeps the grid and offers an inline retry (the interceptor already
  // toasted the ambient error); the sentinel disarms so a dead backend isn't hammered by scrolling.
  const nextPageFailed = isError && Boolean(data) && hasNextPage;
  const sentinelRef = useInfiniteScrollSentinel({
    onReach: () => {
      void fetchNextPage();
    },
    disabled:
      !settled || hasError || !hasNextPage || isFetchingNextPage || isPlaceholderData || nextPageFailed,
  });

  // The page's motion pair, registered with the panel: `exit` is the reverse sweep, played before
  // ANY departure (tab change or logout) for whichever state is on screen; `enter` resumes the
  // reveal when a departure is cancelled mid-exit. Resolves immediately under reduced motion.
  usePanelPageMotion(
    useMemo(
      () => ({
        enter: (options) => staggerIn(root.current, '.reveal-item', options),
        exit: () => staggerOut(root.current, '.reveal-item'),
      }),
      [],
    ),
  );

  // The Admin "add" affordance navigates to the create page THROUGH the panel's body transition
  // (the sidebar keeps the Products tab lit — it's a nested products page).
  const handleAdd = (): void => {
    panelNavigate('/panel/productos/nuevo');
  };

  const addButton = (
    <Button size="sm" startIcon={<HiOutlinePlus className="size-4" />} onClick={handleAdd}>
      {t(`${KEY}.add`)}
    </Button>
  );

  // How many grid SLOTS are on screen. Slots are keyed by INDEX so a cell keeps its identity
  // across the loading → loaded flip — that identity is what lets its SkeletonFade crossfade the
  // skeleton into the card in place instead of remounting. Appended-page skeletons ride the same
  // slot machinery after the real cards.
  const visibleSlots = loading
    ? SKELETON_COUNT
    : showSkeleton
      ? Math.max(SKELETON_COUNT, products.length)
      : products.length + appendCount;

  // A filter change with previous results on screen: keep the grid, dim it while the new page loads.
  const dimming = isPlaceholderData && isFetching;

  // The chrome sweeps out with the skeletons ONLY when the resolution can drop it (unfiltered →
  // possibly the standalone empty/error panel); a filtered resolution always keeps it.
  const chromeSkeletonClass = showSkeleton && !filtered ? ' product-skel' : '';

  return (
    <div ref={root} className="flex flex-1 flex-col gap-6">
      {showChrome ? (
        <>
          {/* The header row needs NO data (static lead + role-gated add), so it's on screen from
              the FIRST skeleton frame — the grid never has to jump down to make room for it later. */}
          <div
            className={`reveal-item products-chrome${chromeSkeletonClass} flex flex-wrap items-center justify-between gap-3`}
          >
            <p className="text-sm text-charcoal/55">{t(`${KEY}.lead`)}</p>
            <RoleGate roles={[Role.Admin]}>{addButton}</RoleGate>
          </div>
          <div className={`reveal-item products-chrome${chromeSkeletonClass}`}>
            <ProductsFilterBar search={search} onChange={applyFilters} />
          </div>
          <div ref={body} className="flex flex-1 flex-col gap-6">
            {filteredEmpty ? (
              <ProductsStatus
                tone="empty"
                title={t(`${KEY}.filteredEmpty.title`)}
                description={t(`${KEY}.filteredEmpty.description`)}
                action={
                  <Button
                    variant="soft"
                    color={SECONDARY_COLOR}
                    size="sm"
                    startIcon={<HiOutlineXMark className="size-4" />}
                    onClick={() => applyFilters({})}
                  >
                    {t(`${KEY}.filteredEmpty.clear`)}
                  </Button>
                }
              />
            ) : (
              <>
                <div
                  className={`${GRID} transition-opacity duration-300${dimming ? ' opacity-60' : ''}`}
                  role={loading ? 'status' : undefined}
                  aria-label={loading ? t(`${KEY}.loading`) : undefined}
                  aria-busy={loading || dimming || isFetchingNextPage || undefined}
                >
                  {Array.from({ length: visibleSlots }).map((_, index) => {
                    const product = products[index];
                    const isAppendCell = settled && product === undefined;
                    const isSkeletonCell = loading || product === undefined;
                    const isOrphan = !loading && showSkeleton && product === undefined;
                    const isLateEntry = !loading && showSkeleton && index >= SKELETON_COUNT;
                    const cellClass = `reveal-item${isSkeletonCell ? ' product-skel' : ''}${
                      isOrphan ? ' product-skel-orphan' : ''
                    }${isLateEntry ? ' grid-enter' : ''}${isAppendCell ? ' append-skel' : ''}`;
                    return (
                      <div key={`slot-${index}`} className={cellClass}>
                        {isOrphan ? (
                          // An orphan has no data partner to become — it waits (visually unchanged)
                          // for its staggered sweep-out.
                          <ProductCardSkeleton />
                        ) : (
                          <SkeletonFade
                            loading={loading || isAppendCell}
                            skeleton={<ProductCardSkeleton />}
                            className="block"
                            contentClassName="block"
                          >
                            {product && <ProductCard product={product} />}
                          </SkeletonFade>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                {/* The count line mounts with the populated resolution (tagged `.grid-enter`, so the
                    hand-off sweeps it in with the surplus cards) and doubles as scroll progress.
                    `aria-live` = the standard results-count announcement for a filterable list, so
                    non-visual users hear the result set change (filter applied, page appended). */}
                {!loading && !hasError && products.length > 0 && total !== undefined && (
                  <p
                    aria-live="polite"
                    className={`reveal-item text-center text-xs text-charcoal/45${showSkeleton ? ' grid-enter' : ''}`}
                  >
                    {products.length < total
                      ? t(`${KEY}.count.partial`, { shown: products.length, total })
                      : t(`${KEY}.count.all`, { count: total })}
                  </p>
                )}
                {/* The invisible sentinel that triggers the next page as it nears the viewport. */}
                <div ref={sentinelRef} aria-hidden className="h-px" />
              </>
            )}
          </div>
        </>
      ) : hasError ? (
        // Cold error stands alone (no header) — the centered panel IS the screen.
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
              onClick={() => void refetch()}
              startIcon={<HiOutlineArrowPath className="size-4" />}
            >
              {t(`${KEY}.error.retry`)}
            </Button>
          }
        />
      ) : (
        // Empty catalog stands alone too — no "explore"/header chrome when there's nothing to explore.
        // Admin gets its single "add first product" CTA inside the panel (no redundant top button).
        <RoleGate
          roles={[Role.Admin]}
          fallback={
            <ProductsStatus
              tone="empty"
              title={t(`${KEY}.empty.title`)}
              description={t(`${KEY}.empty.description`)}
            />
          }
        >
          <ProductsStatus
            tone="empty"
            title={t(`${KEY}.empty.adminTitle`)}
            description={t(`${KEY}.empty.adminDescription`)}
            action={addButton}
          />
        </RoleGate>
      )}
    </div>
  );
};

export default ProductsPage;
