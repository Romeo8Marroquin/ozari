import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowPath, HiOutlinePlus } from 'react-icons/hi2';
import Button from '@components/Button';
import RoleGate from '@components/RoleGate';
import SkeletonFade from '@components/SkeletonFade';
import { Role } from '@constants/Roles';
import { staggerIn, staggerOut } from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import ProductCard from './ProductCard';
import ProductCardSkeleton from './ProductCardSkeleton';
import ProductsStatus from './ProductsStatus';
import { useProducts } from './useProducts';

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
 * The whole screen is choreographed so no state ever "pops". The load is a **pairwise hand-off**
 * over stable grid SLOTS (the SkeletonFade doctrine, per cell): a skeleton that received data
 * **crossfades into its card in place**; orphan skeletons (no data partner) sweep out staggered,
 * exactly as they entered; surplus cards beyond the skeleton count sweep in staggered. Empty and
 * error resolutions still sweep the whole skeleton grid out before their panel staggers in. The
 * page owns its entrance and registers its exit with the panel; all motion lives in the shared
 * `pageMotion` vocabulary and snaps under reduced motion (an instant, correct swap).
 */
const ProductsPage: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const { data, isLoading, isError, isFetching, refetch } = useProducts();
  const root = useRef<HTMLDivElement>(null);

  const products = data?.products ?? [];
  // Only a COLD state (nothing cached to show) drives the skeleton / error panel; a background refetch
  // keeps the current grid on screen instead of flashing back to skeletons.
  const loading = isLoading && !data;
  const hasError = isError && !data;

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
  // skeletons sweep out before the skeleton phase ends. EMPTY/ERROR: the whole skeleton grid
  // sweeps out, then the panel staggers in (the effect below). State changes land in the async
  // completions, never synchronously in the effect body.
  useEffect(() => {
    if (loading || !showSkeleton) return;
    if (!hasError && products.length > 0) {
      staggerIn(root.current, '.grid-enter');
      void staggerOut(root.current, '.product-skel-orphan').then(() => setShowSkeleton(false));
      return;
    }
    void staggerOut(root.current, '.product-skel').then(() => setShowSkeleton(false));
  }, [loading, showSkeleton, hasError, products.length]);

  // Entrances that are NOT part of the pairwise hand-off: the mount (whatever state it lands in),
  // a re-entered cold load (the skeleton grid returns), and the empty/error panels once the
  // skeleton finished sweeping. A COMPLETED populated hand-off is deliberately excluded — its
  // cards already crossfaded in place; re-staggering them would flash the settled grid.
  const empty = products.length === 0;
  const isMounted = useRef(false);
  const wasPopulated = useRef(false);
  useLayoutEffect(() => {
    const firstRender = !isMounted.current;
    isMounted.current = true;
    const populated = !loading && !hasError && !empty;
    // The grid can ALSO appear straight from a settled panel (error → successful retry) with no
    // skeleton phase in between — that arrival needs its own entrance or the cards would pop.
    const arrivedFromPanel = populated && !wasPopulated.current && !showSkeleton;
    wasPopulated.current = populated;
    if (firstRender || loading || (!showSkeleton && !populated) || arrivedFromPanel) {
      staggerIn(root.current, '.reveal-item');
    }
  }, [loading, showSkeleton, hasError, empty]);

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
  // skeleton into the card in place instead of remounting.
  const visibleSlots = loading
    ? SKELETON_COUNT
    : showSkeleton
      ? Math.max(SKELETON_COUNT, products.length)
      : products.length;

  return (
    <div ref={root} className="flex flex-1 flex-col gap-6">
      {showSkeleton || (!hasError && products.length > 0) ? (
        <>
          {/* The header row needs NO data (static lead + role-gated add), so it's on screen from
              the FIRST skeleton frame — the grid never has to jump down to make room for it later.
              While the skeleton phase lasts it carries `product-skel`, so an empty/error resolution
              sweeps it out together with the shimmer (those panels stand alone, headerless). */}
          <div
            className={`reveal-item${showSkeleton ? ' product-skel' : ''} flex flex-wrap items-center justify-between gap-3`}
          >
            <p className="text-sm text-charcoal/55">{t(`${KEY}.lead`)}</p>
            <RoleGate roles={[Role.Admin]}>{addButton}</RoleGate>
          </div>
          <div
            className={GRID}
            role={loading ? 'status' : undefined}
            aria-label={loading ? t(`${KEY}.loading`) : undefined}
          >
            {Array.from({ length: visibleSlots }).map((_, index) => {
              const product = products[index];
              const isSkeletonCell = loading || (showSkeleton && product === undefined);
              const isOrphan = !loading && showSkeleton && product === undefined;
              const isLateEntry = !loading && index >= SKELETON_COUNT;
              const cellClass = `reveal-item${isSkeletonCell ? ' product-skel' : ''}${
                isOrphan ? ' product-skel-orphan' : ''
              }${isLateEntry ? ' grid-enter' : ''}`;
              return (
                <div key={`slot-${index}`} className={cellClass}>
                  {isOrphan ? (
                    // An orphan has no data partner to become — it waits (visually unchanged) for
                    // its staggered sweep-out.
                    <ProductCardSkeleton />
                  ) : (
                    <SkeletonFade
                      loading={loading}
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
