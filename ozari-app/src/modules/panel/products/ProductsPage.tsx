import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowPath, HiOutlinePlus } from 'react-icons/hi2';
import Button from '@components/Button';
import RoleGate from '@components/RoleGate';
import { Role } from '@constants/Roles';
import { staggerIn, staggerOut } from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import ProductCard from './ProductCard';
import ProductCardSkeleton from './ProductCardSkeleton';
import ProductsStatus from './ProductsStatus';
import { useProducts } from './useProducts';

const KEY = 'modules.panel.products';

// Responsive grid: two columns on phones up to six on ultrawide/vertical monitors, so the visible
// area fills with cards on any display. Skeleton and real cards share this exact layout so each card
// lands where its skeleton stood.
const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6';

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
 * The whole screen is choreographed so no state ever "pops": a staggered **skeleton** grid fills the
 * view, then hands off — the skeletons sweep out and the resolved view (cards, an empty panel, or a
 * cold-error panel) staggers into their place. The page owns its entrance and registers its exit with
 * the panel, so departing any state animates out cleanly. All motion lives in the shared panel
 * `pageMotion` vocabulary and snaps under reduced motion; that path is an instant, correct swap.
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

  // Once loading finishes, sweep the still-mounted skeleton out, then unmount it. The state change
  // lands in the async completion, never synchronously in the effect body.
  useEffect(() => {
    if (loading || !showSkeleton) return;
    void staggerOut(root.current, '.product-skel').then(() => setShowSkeleton(false));
  }, [loading, showSkeleton]);

  // Everything on screen (the header row when populated, skeletons, cards, or a status panel) is a
  // `.reveal-item` and staggers in on each phase change — mount included, so this IS the page's
  // entrance — and the hand-off reads as "content settling into place", never a flash.
  const empty = products.length === 0;
  useLayoutEffect(() => {
    staggerIn(root.current, '.reveal-item');
  }, [showSkeleton, hasError, empty]);

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

  return (
    <div ref={root} className="flex flex-1 flex-col gap-6">
      {showSkeleton ? (
        <div className={GRID} role="status" aria-label={t(`${KEY}.loading`)}>
          {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
            <div key={index} className="reveal-item product-skel">
              <ProductCardSkeleton />
            </div>
          ))}
        </div>
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
      ) : products.length === 0 ? (
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
      ) : (
        // Populated: the header row (lead + Admin "add") makes sense here, above the grid.
        <>
          <div className="reveal-item flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-charcoal/55">{t(`${KEY}.lead`)}</p>
            <RoleGate roles={[Role.Admin]}>{addButton}</RoleGate>
          </div>
          <div className={GRID}>
            {products.map((product) => (
              <div key={product.id} className="reveal-item">
                <ProductCard product={product} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ProductsPage;
