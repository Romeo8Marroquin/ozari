import { useParams } from '@tanstack/react-router';
import type { AxiosError } from 'axios';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowLeft,
  HiOutlineArrowPath,
  HiOutlineCalendarDays,
  HiOutlineClipboardDocumentList,
  HiOutlinePencilSquare,
  HiOutlineShoppingBag,
  HiOutlineTrash,
} from 'react-icons/hi2';
import Button from '@components/Button';
import LogoMark from '@components/LogoMark';
import RoleGate from '@components/RoleGate';
import { Role } from '@constants/Roles';
import { useRole } from '@hooks/useRole';
import { getStatus } from '@utils/apiError';
import { clearHistoryDepartureHold, setHistoryDepartureHold } from '@utils/historyDeparture';
import { headerTitleOut, staggerIn, staggerOut } from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import { SELL_BUSINESS_TYPE } from './ProductCard';
import {
  beginProductImageMorph,
  claimProductImageMorph,
  hasProductImageMorphInFlight,
  releaseProductImageMorph,
} from './productImageMorph';
import { scrollPanelToTop } from './productsScroll';
import ProductsStatus from './ProductsStatus';
import { formatMoney, formatProductPrice } from './productPresentation';
import { useProduct } from './useProduct';
import type { Product } from './product.types';

const KEY = 'modules.panel.products';
const DKEY = `${KEY}.detail`;
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';

/**
 * The stock line — same field-presence contract as the card's badge: `quantity` (Employee + Admin)
 * → the available count in the role's ink; bare `inStock` → the signal; neither (Client) → nothing.
 */
const StockLine: React.FC<{ product: Product }> = ({ product }) => {
  const { t } = useTranslation();
  const { quantity, inStock } = product;
  let available: boolean;
  let label: string;
  if (quantity !== undefined) {
    available = quantity > 0;
    label = available ? t(`${KEY}.stock.count`, { count: quantity }) : t(`${KEY}.stock.out`);
  } else if (inStock !== undefined) {
    available = inStock;
    label = inStock ? t(`${KEY}.stock.available`) : t(`${KEY}.stock.out`);
  } else {
    return null;
  }
  return (
    <p
      className={`reveal-item inline-flex w-fit items-center rounded-chip px-2.5 py-1 text-xs font-semibold ${
        available ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
      }`}
    >
      {label}
    </p>
  );
};

/** The shimmering placeholder for a COLD load (a deep link — arriving from the grid is cache-warm). */
const DetailSkeleton: React.FC = () => (
  <div className="grid gap-6 lg:grid-cols-2 lg:gap-10" aria-hidden>
    <div className="reveal-item aspect-[4/3] animate-pulse rounded-card bg-charcoal/[0.06]" />
    <div className="flex flex-col gap-4">
      <div className="reveal-item h-5 w-40 animate-pulse rounded-chip bg-charcoal/[0.06]" />
      <div className="reveal-item h-8 w-3/4 animate-pulse rounded-chip bg-charcoal/[0.06]" />
      <div className="reveal-item h-6 w-32 animate-pulse rounded-chip bg-charcoal/[0.06]" />
      <div className="reveal-item h-24 w-full animate-pulse rounded-control bg-charcoal/[0.06]" />
      <div className="reveal-item h-11 w-48 animate-pulse rounded-control bg-charcoal/[0.06]" />
    </div>
  </div>
);

/**
 * The product detail (`/panel/productos/:id`) — the card's destination, open to every role with the
 * same role-projected data (the backend narrows the fields; the UI reacts to what arrives).
 *
 * **Arrival is designed around the shared-element morph** (see `productImageMorph.ts`): the query
 * is seeded from the cached list pages, so coming from the grid renders the full page instantly and
 * the floating card photo glides onto the hero (which sits out of the entrance stagger while it
 * waits — the morph reveals it). A cold deep-link skips all of that: skeleton → content, standard
 * stagger, any in-flight clone is released. Errors split not-found (404, gone) from transient
 * (retry).
 *
 * Role actions mirror the card's mapping — Client → Rentar/Comprar, Employee/Admin → Ordenar — plus
 * Admin's management verbs **Editar/Eliminar** (design-complete placeholders; Step 3b wires them).
 */
const ProductDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const role = useRole();
  const { productId } = useParams({ from: '/panel/productos_/$productId' });
  const id = Number(productId);
  const { data: product, isLoading, isError, isFetching, refetch, error } = useProduct(id);
  const root = useRef<HTMLDivElement>(null);
  const heroWrap = useRef<HTMLDivElement>(null);
  const heroImage = useRef<HTMLImageElement>(null);

  const loading = isLoading && !product;
  const notFound = isError && !product && getStatus(error as AxiosError) === 404;
  const hasError = isError && !product && !notFound;

  // The visible gallery image (primary first — the backend orders them that way).
  const [activeIndex, setActiveIndex] = useState(0);
  const images = useMemo(() => product?.images ?? [], [product]);
  const activeImage = images[activeIndex] ?? images[0];

  // A detail page always OPENS AT THE TOP — the shared panel scroller still carries the grid's
  // position otherwise. Pre-paint and before the morph claim below (declaration order), so the
  // hero's landing rect is measured where the page will actually be seen.
  const scrolledToTop = useRef(false);
  useLayoutEffect(() => {
    if (scrolledToTop.current) return;
    scrolledToTop.current = true;
    scrollPanelToTop();
  });

  // Claim the shared-element morph ONCE, before first paint. When a clone with this product's
  // "animation id" is in flight, the hero leaves the entrance stagger (the morph owns its reveal)
  // and rejoins it via `onSettled` — which the module also fires on ANY interruption, so the hero
  // can never be stranded hidden or outside the page sweeps. No matching clone (deep link, reduced
  // motion, retargeted navigation) → any stray clone is released and the standard entrance
  // proceeds. Runs before the stagger effect below (declaration order).
  const claimAttempted = useRef(false);
  useLayoutEffect(() => {
    if (claimAttempted.current) return;
    const heroElement = heroWrap.current;
    if (!heroElement) {
      // No hero yet (cold skeleton / error) — never leave a clone floating over it.
      claimAttempted.current = true;
      releaseProductImageMorph();
      return;
    }
    claimAttempted.current = true;
    heroElement.classList.remove('reveal-item');
    const claimed = claimProductImageMorph(id, heroElement, heroElement, () =>
      heroElement.classList.add('reveal-item'),
    );
    if (!claimed) heroElement.classList.add('reveal-item');
  });

  // Entrance for whichever state is on screen (mount, skeleton→content, error→retry→content).
  useLayoutEffect(() => {
    staggerIn(root.current, '.reveal-item');
  }, [loading, notFound, hasError]);

  usePanelPageMotion(
    useMemo(
      () => ({
        enter: (options) => staggerIn(root.current, '.reveal-item', options),
        exit: () => staggerOut(root.current, '.reveal-item'),
      }),
      [],
    ),
  );

  // The REVERSE morph: the hero lifts off toward the grid (its card claims the clone when it
  // mounts — cache-warm, so effectively immediately; a cold grid releases it). The flight aims at
  // the remembered return rect (the card's resting frame).
  const goBack = (): void => {
    beginProductImageMorph(id, heroImage.current);
    panelNavigate('/panel/productos');
  };

  // BROWSER/DEVICE back gets the SAME departure as the in-app back affordance: lift the hero off,
  // play this page's exit choreography, THEN let the router commit — the exact order
  // `panelNavigate` produces, so both backs pace identically. Implemented on the popstate
  // interceptor (`utils/historyDeparture`) — a router blocker was tried and REVERTED: it can't
  // hold a popstate, so it rolls back and re-applies the navigation, committing the grid twice
  // (a visible blink of its entrance). The hold declines anything not headed to the grid, and
  // declines the interceptor's own re-dispatched event (the morph is in flight by then).
  useEffect(() => {
    const hold = (nextPathname: string): Promise<void> | null => {
      if (nextPathname !== '/panel/productos') return null;
      if (hasProductImageMorphInFlight()) return null;
      beginProductImageMorph(id, heroImage.current);
      return Promise.all([staggerOut(root.current, '.reveal-item'), headerTitleOut()]).then(
        () => undefined,
      );
    };
    setHistoryDepartureHold(hold);
    return () => clearHistoryDepartureHold(hold);
  }, [id]);

  // Fallback for history departures the blocker didn't see lift off (edge orderings): React runs
  // this cleanup while the DOM is still attached and the URL has already flipped — if we're headed
  // to the grid and no morph is in flight yet, lift the hero off here. The grid's normal arrival
  // claims and lands it — same machinery, no special path.
  useLayoutEffect(() => {
    return () => {
      if (hasProductImageMorphInFlight()) return;
      if (window.location.pathname !== '/panel/productos') return;
      // Reading the LIVE ref at unmount is the point: thumbnails can swap the hero, and the image
      // visible NOW is what must lift off — a captured variable would be the stale first one.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      beginProductImageMorph(id, heroImage.current);
    };
  }, [id]);

  const backButton = (
    <button
      type="button"
      onClick={goBack}
      className="reveal-item flex w-fit cursor-pointer items-center gap-1.5 rounded-chip text-sm text-charcoal/55 transition-colors hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2"
    >
      <HiOutlineArrowLeft aria-hidden className="size-4" />
      {t(`${DKEY}.back`)}
    </button>
  );

  const isSell = product?.businessType === SELL_BUSINESS_TYPE;

  return (
    <div ref={root} className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
      {loading ? (
        <>
          {backButton}
          <div role="status" aria-label={t(`${DKEY}.loading`)}>
            <DetailSkeleton />
          </div>
        </>
      ) : notFound ? (
        <ProductsStatus
          tone="empty"
          title={t(`${DKEY}.notFound.title`)}
          description={t(`${DKEY}.notFound.description`)}
          action={
            <Button
              variant="soft"
              color={SECONDARY_COLOR}
              size="sm"
              startIcon={<HiOutlineArrowLeft className="size-4" />}
              onClick={goBack}
            >
              {t(`${DKEY}.notFound.back`)}
            </Button>
          }
        />
      ) : hasError ? (
        <ProductsStatus
          tone="error"
          title={t(`${DKEY}.error.title`)}
          description={t(`${DKEY}.error.description`)}
          action={
            <Button
              variant="soft"
              color={SECONDARY_COLOR}
              size="sm"
              loading={isFetching}
              startIcon={<HiOutlineArrowPath className="size-4" />}
              onClick={() => void refetch()}
            >
              {t(`${DKEY}.error.retry`)}
            </Button>
          }
        />
      ) : (
        product && (
          <>
            {backButton}
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
              {/* ── Gallery ─────────────────────────────────────────────────────────────── */}
              <div className="flex flex-col gap-3">
                {/* The hero — the morph's TARGET (same `data-morph-id` as the card photo). */}
                <div
                  ref={heroWrap}
                  data-morph-id={id}
                  className="reveal-item relative aspect-[4/3] overflow-hidden rounded-card bg-white ring-1 ring-black/[0.04] shadow-sm"
                >
                  {activeImage ? (
                    <img
                      ref={heroImage}
                      src={activeImage.url}
                      alt={t(`${KEY}.imageAlt`, { name: product.name })}
                      className="absolute inset-0 size-full object-cover"
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-cream to-blossom text-charcoal/25">
                      <LogoMark className="size-20" />
                    </span>
                  )}
                </div>
                {images.length > 1 && (
                  <div className="reveal-item flex flex-wrap gap-2">
                    {images.map((image, index) => (
                      <button
                        key={image.id}
                        type="button"
                        aria-label={t(`${DKEY}.thumbAlt`, { index: index + 1, name: product.name })}
                        aria-current={index === activeIndex || undefined}
                        onClick={() => setActiveIndex(index)}
                        className={`relative size-16 cursor-pointer overflow-hidden rounded-control transition-[box-shadow,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta ${
                          index === activeIndex
                            ? 'ring-2 ring-charcoal'
                            : 'opacity-70 ring-1 ring-black/[0.06] hover:opacity-100'
                        }`}
                      >
                        <img src={image.url} alt="" className="absolute inset-0 size-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Info ────────────────────────────────────────────────────────────────── */}
              <div className="flex flex-col gap-4">
                <div className="reveal-item flex flex-wrap gap-2">
                  <span className="rounded-chip bg-charcoal/[0.05] px-2.5 py-1 text-xs font-medium text-charcoal/70">
                    {product.category}
                  </span>
                  <span className="rounded-chip bg-charcoal/[0.05] px-2.5 py-1 text-xs font-medium text-charcoal/70">
                    {product.businessType}
                  </span>
                </div>
                <h2 className="reveal-item text-2xl font-bold text-charcoal sm:text-3xl">{product.name}</h2>
                {formatProductPrice(product) && (
                  <p className="reveal-item text-xl font-bold text-charcoal">{formatProductPrice(product)}</p>
                )}
                <StockLine product={product} />
                {/* Field-presence gated (the projection only sends it to Admin): what the business
                    charges if the product is lost or damaged. Captured on the create form — this
                    is where the admin sees it again. */}
                {product.replacementPrice !== undefined && (
                  <p className="reveal-item text-sm text-charcoal/70">
                    <span className="font-medium text-charcoal/60">{t(`${DKEY}.replacementPrice`)}: </span>
                    {formatMoney(product.replacementPrice, product.currency.symbol)}
                  </p>
                )}
                <div className="reveal-item flex flex-col gap-1.5">
                  <h3 className="text-sm font-semibold text-charcoal">{t(`${DKEY}.descriptionTitle`)}</h3>
                  <p className="text-sm leading-relaxed text-charcoal/70">
                    {product.description ?? t(`${KEY}.card.noDescription`)}
                  </p>
                </div>
                {product.details.length > 0 && (
                  <div className="reveal-item flex flex-col gap-1.5">
                    <h3 className="text-sm font-semibold text-charcoal">{t(`${DKEY}.detailsTitle`)}</h3>
                    <dl className="flex flex-col gap-1">
                      {product.details.map((detail) => (
                        <div key={detail.id} className="flex gap-2 text-sm">
                          <dt className="font-medium text-charcoal/60">{detail.detailType}:</dt>
                          <dd className="text-charcoal/85">{detail.detail}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {/* Role actions — the card's mapping, full-size. Ordering/renting/buying land with
                    the orders epic; Editar/Eliminar are design-complete placeholders for Step 3b. */}
                <div className="reveal-item mt-2 flex flex-wrap gap-3">
                  {role === Role.Client ? (
                    isSell ? (
                      <Button size="sm" startIcon={<HiOutlineShoppingBag className="size-4" />}>
                        {t(`${KEY}.card.actions.buy`)}
                      </Button>
                    ) : (
                      <Button size="sm" startIcon={<HiOutlineCalendarDays className="size-4" />}>
                        {t(`${KEY}.card.actions.rent`)}
                      </Button>
                    )
                  ) : (
                    <Button size="sm" startIcon={<HiOutlineClipboardDocumentList className="size-4" />}>
                      {t(`${KEY}.card.actions.order`)}
                    </Button>
                  )}
                  <RoleGate roles={[Role.Admin]}>
                    <Button
                      variant="soft"
                      color={SECONDARY_COLOR}
                      size="sm"
                      startIcon={<HiOutlinePencilSquare className="size-4" />}
                    >
                      {t(`${DKEY}.actions.edit`)}
                    </Button>
                    <Button
                      variant="soft"
                      color={DANGER_COLOR}
                      size="sm"
                      startIcon={<HiOutlineTrash className="size-4" />}
                    >
                      {t(`${DKEY}.actions.delete`)}
                    </Button>
                  </RoleGate>
                </div>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
};

export default ProductDetailPage;
