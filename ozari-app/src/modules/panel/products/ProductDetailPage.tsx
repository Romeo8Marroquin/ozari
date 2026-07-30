import { useParams } from '@tanstack/react-router';
import type { AxiosError } from 'axios';
import gsap from 'gsap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowLeft,
  HiOutlineArrowPath,
  HiOutlineArrowsPointingOut,
  HiOutlineCalendarDays,
  HiOutlinePencilSquare,
  HiOutlineShoppingBag,
  HiOutlineTrash,
} from 'react-icons/hi2';
import Button from '@components/Button';
import LogoMark from '@components/LogoMark';
import RoleGate from '@components/RoleGate';
import ShareButton from '@components/ShareButton';
import { Role } from '@constants/Roles';
import { useRole } from '@hooks/useRole';
import { getStatus } from '@utils/apiError';
import { clearHistoryDepartureHold, setHistoryDepartureHold } from '@utils/historyDeparture';
import { prefersReducedMotion } from '@utils/motion';
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
import ProductDeleteModal from './ProductDeleteModal';
import ImageLightbox from '@components/ImageLightbox';
import { scrollPanelToTop } from './productsScroll';
import ProductsStatus from './ProductsStatus';
import SectionReveal from './SectionReveal';
import { formatMoney, formatProductPrice, primaryImageIndex } from './productPresentation';
import { useProduct } from './useProduct';
import type { Product } from './product.types';

const KEY = 'modules.panel.products';
const DKEY = `${KEY}.detail`;
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';

/**
 * The stock line — same field-presence contract as the card's badge: `available` + `total`
 * (Admin, Alquiler) → the fleet view "5 de 10 disponibles", spelled out here where space allows
 * (the tile keeps the short "5 de 10") and kept visible at 0 — a fully-rented fleet is not gone;
 * `available` alone (Admin-Venta) → the takeable count; bare `inStock` → the signal;
 * neither (Client) → nothing. Zero wording is business-type-aware like the card's: Venta =
 * "Agotado" (gone until restocked), anything else = "No disponible" (rented units come back).
 */
const StockLine: React.FC<{ product: Product }> = ({ product }) => {
  const { t } = useTranslation();
  const { available: availableCount, total, inStock } = product;
  const zeroLabel =
    product.businessType === SELL_BUSINESS_TYPE
      ? t(`${KEY}.stock.out`)
      : t(`${KEY}.stock.unavailable`);
  let available: boolean;
  let label: string;
  if (availableCount !== undefined) {
    available = availableCount > 0;
    if (total !== undefined) {
      label = t(`${KEY}.stock.countOfTotal`, { count: availableCount, total });
    } else {
      label = available ? t(`${KEY}.stock.count`, { count: availableCount }) : zeroLabel;
    }
  } else if (inStock !== undefined) {
    available = inStock;
    label = inStock ? t(`${KEY}.stock.available`) : zeroLabel;
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
 * The product detail (`/panel/productos/:id`) — the card's destination, open to Admin + Client
 * (the route guard bounces a Driver, mirroring the backend 403) with the same role-projected data
 * (the backend narrows the fields; the UI reacts to what arrives).
 *
 * **Arrival is designed around the shared-element morph** (see `productImageMorph.ts`): the query
 * is seeded from the cached list pages, so coming from the grid renders the full page instantly and
 * the floating card photo glides onto the hero (which sits out of the entrance stagger while it
 * waits — the morph reveals it). A cold deep-link skips all of that: the skeleton shows, and when
 * the data lands it dissolves IN PLACE while the content cascades in (`SectionReveal` — never a
 * blank-out + re-entrance); any in-flight clone is released. Errors split not-found (404, gone)
 * from transient (retry).
 *
 * Role actions mirror the card's mapping — Client → Rentar/Comprar (the old Employee/Admin
 * "Ordenar" is gone; Epic-2A) — plus Admin's management verbs: **Editar** navigates to
 * `/panel/productos/:id/editar` (the edit form); **Eliminar** opens the delete confirmation.
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
  // A 404 wins even over cached data: a background refetch discovering the product was deleted
  // elsewhere must flip to the honest not-found panel, never keep rendering a ghost.
  const notFound = isError && getStatus(error as AxiosError) === 404;
  const hasError = isError && !product && !notFound;

  // The visible gallery image. `null` = "no explicit pick yet" → the FLAGGED primary, wherever it
  // sits in the gallery: images arrive in the admin's display order and the star is independent of
  // it, so the page OPENS on the primary without reordering the thumbnails around it.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const images = useMemo(() => product?.images ?? [], [product]);
  const activeIndex = selectedIndex ?? (product ? primaryImageIndex(product) : 0);
  const activeImage = images[activeIndex] ?? images[0];

  // The full-size viewer (opens on the hero / its expand affordance, at the current image).
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // The delete confirmation (Admin's Eliminar) — destructive, so always an explicit dialog step.
  const [deleteOpen, setDeleteOpen] = useState(false);
  // True once THIS product was deleted: the departure to the grid must be a PLAIN fade — there is
  // no card left to fly the hero onto, so every morph lift-off below stands down.
  const deletedRef = useRef(false);
  const handleDeleted = (): void => {
    deletedRef.current = true;
    panelNavigate('/panel/productos');
  };

  // Switching images CROSSFADES (never snaps): the outgoing image stays as a ghost layer under
  // the incoming one, which fades in quick-but-smooth; the ghost drops when the fade settles.
  const [ghostImageUrl, setGhostImageUrl] = useState<string | null>(null);
  const selectImage = (index: number): void => {
    if (index === activeIndex) return;
    /* v8 ignore next -- defensive `??`: the thumbnails only render alongside an active image */
    setGhostImageUrl(activeImage?.url ?? null);
    setSelectedIndex(index);
  };
  useLayoutEffect(() => {
    if (!ghostImageUrl) return;
    const incoming = heroImage.current;
    /* v8 ignore next -- a ghost only exists after a switch, when the hero img is mounted */
    if (!incoming) return;
    const seconds = prefersReducedMotion() ? 0 : 0.22;
    const tween = gsap.fromTo(
      incoming,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: seconds, ease: 'power2.inOut', onComplete: () => setGhostImageUrl(null) },
    );
    return () => {
      tween.kill();
    };
  }, [ghostImageUrl]);

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

  // Entrance on mount and when an ERROR panel replaces the content. Deliberately NOT keyed on
  // `loading`: skeleton → content is `SectionReveal`'s move — the skeleton stays on screen and
  // dissolves while the real items cascade in. Replaying the page stagger there would blank
  // everything (back row included) and re-run the whole entrance — the "reload" jank.
  useLayoutEffect(() => {
    staggerIn(root.current, '.reveal-item');
  }, [notFound, hasError]);

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
  // (a visible blink of its entrance). The hold declines anything not headed to the grid, and an
  // already-in-flight morph (e.g. a back racing the in-app affordance's lift-off). The
  // interceptor's own re-dispatched event never reaches the hold — the interceptor marks and
  // skips it itself. It MUST NOT be this guard: `beginProductImageMorph` silently no-ops for a
  // hero with no photo or a stale return rect (chained backs), so "the morph is in flight by
  // then" was false in exactly those cases and the old hold-declines-the-second-pass contract
  // looped the re-dispatch forever — the blank-page-after-chained-backs bug.
  useEffect(() => {
    const hold = (nextPathname: string): Promise<void> | null => {
      if (nextPathname !== '/panel/productos') return null;
      if (deletedRef.current) return null; // deleted → plain fade, nothing to fly onto
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
      if (deletedRef.current) return; // deleted → plain fade, nothing to fly onto
      if (hasProductImageMorphInFlight()) return;
      if (window.location.pathname !== '/panel/productos') return;
      // Reading the LIVE ref at unmount is the point: thumbnails can swap the hero, and the image
      // visible NOW is what must lift off — a captured variable would be the stale first one.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      beginProductImageMorph(id, heroImage.current);
    };
  }, [id]);

  const isSell = product?.businessType === SELL_BUSINESS_TYPE;

  return (
    <div ref={root} className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
      {notFound ? (
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
        <>
          {/* The back affordance + the page's SHARE — real chrome from first paint, OUTSIDE the
              reveal so the skeleton → content hand-off never touches it. The share is ALWAYS
              mounted (it sizes the row from the first frame — a late mount reflowed the whole
              column, the "glitch tilt") and merely FADES in once the product is known: binary
              state, so CSS owns the transition. While hidden it is inert + aria-hidden (nothing
              focusable/clickable shares a nameless product). A warm arrival renders it visible
              from the first frame, so the grid→detail morph sees exactly what it always saw.
              Share = the product's deep link; every role can spread the catalog (hidden info
              never leaves the server anyway). */}
          <div className="reveal-item flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              className="flex w-fit cursor-pointer items-center gap-1.5 rounded-chip text-sm text-charcoal/55 transition-colors hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2"
            >
              <HiOutlineArrowLeft aria-hidden className="size-4" />
              {t(`${DKEY}.back`)}
            </button>
            <div
              aria-hidden={!product}
              inert={!product}
              className={`transition-opacity duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
                product ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <ShareButton title={product?.name ?? ''} url={window.location.href} />
            </div>
          </div>
          {/* Skeleton → content is an IN-PLACE reveal (the add-product doctrine): the shimmer
              dissolves while the real items cascade in — never a blank-out + re-entrance. */}
          <SectionReveal
            loading={loading}
            skeleton={
              <div role="status" aria-label={t(`${DKEY}.loading`)}>
                <DetailSkeleton />
              </div>
            }
          >
            {product && (
              <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
              {/* ── Gallery ─────────────────────────────────────────────────────────────── */}
              <div className="flex flex-col gap-3">
                {/* The hero — the morph's TARGET (same `data-morph-id` as the card photo). */}
                <div
                  ref={heroWrap}
                  data-morph-id={id}
                  className="reveal-item relative aspect-[4/3] overflow-hidden rounded-card bg-white ring-1 ring-black/[0.04] shadow-sm"
                >
                  {/* The GHOST layer (the outgoing image) sits under the incoming one during the
                      crossfade — rendered first so the real hero stays on top. */}
                  {ghostImageUrl && (
                    <img
                      aria-hidden
                      src={ghostImageUrl}
                      className="absolute inset-0 size-full object-cover"
                    />
                  )}
                  {activeImage ? (
                    <>
                      <img
                        ref={heroImage}
                        data-testid="product-hero-image"
                        src={activeImage.url}
                        alt={t(`${KEY}.imageAlt`, { name: product.name })}
                        className="absolute inset-0 size-full object-cover"
                      />
                      {/* The whole hero opens the full-size viewer; the corner glyph is the
                          visible affordance (part of the same button — one control). */}
                      <button
                        type="button"
                        aria-label={t(`${DKEY}.lightbox.open`)}
                        onClick={() => setLightboxOpen(true)}
                        className="group/zoom absolute inset-0 z-[1] cursor-zoom-in rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
                      >
                        <span className="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-white/85 text-charcoal opacity-75 shadow-sm transition-[opacity,scale] duration-200 ease-[var(--ease-settle)] group-hover/zoom:scale-105 group-hover/zoom:opacity-100 motion-reduce:transition-none">
                          <HiOutlineArrowsPointingOut aria-hidden className="size-4" />
                        </span>
                      </button>
                    </>
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
                        onClick={() => selectImage(index)}
                        // ACTIVE = the brand magenta, thicker, with a settle-eased pop (scale) —
                        // the selection reads instantly; FOCUS = charcoal (swapped on purpose so
                        // keyboard focus and selection never look alike); HOVER = a slight lift
                        // and grow, not just the opacity clear. Transitions name `scale`/
                        // `translate` explicitly (Tailwind v4 independent-property trap).
                        className={`relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-control transition-[box-shadow,opacity,scale,translate] duration-200 ease-[var(--ease-settle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal motion-reduce:transition-none ${
                          index === activeIndex
                            ? 'scale-[1.06] ring-[2.5px] ring-magenta'
                            : 'opacity-70 ring-1 ring-black/[0.06] hover:-translate-y-0.5 hover:scale-[1.04] hover:opacity-100'
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

                {/* Role actions — the card's mapping, full-size. Renting/buying land with the
                    orders epic; Editar opens the edit form; Eliminar opens the delete dialog. */}
                <div className="reveal-item mt-2 flex flex-wrap gap-3">
                  {role === Role.Client &&
                    (isSell ? (
                      <Button size="sm" startIcon={<HiOutlineShoppingBag className="size-4" />}>
                        {t(`${KEY}.card.actions.buy`)}
                      </Button>
                    ) : (
                      <Button size="sm" startIcon={<HiOutlineCalendarDays className="size-4" />}>
                        {t(`${KEY}.card.actions.rent`)}
                      </Button>
                    ))}
                  <RoleGate roles={[Role.Admin]}>
                    <Button
                      variant="soft"
                      color={SECONDARY_COLOR}
                      size="sm"
                      startIcon={<HiOutlinePencilSquare className="size-4" />}
                      onClick={() => panelNavigate(`/panel/productos/${id}/editar`)}
                    >
                      {t(`${DKEY}.actions.edit`)}
                    </Button>
                    <Button
                      variant="soft"
                      color={DANGER_COLOR}
                      size="sm"
                      startIcon={<HiOutlineTrash className="size-4" />}
                      onClick={() => setDeleteOpen(true)}
                    >
                      {t(`${DKEY}.actions.delete`)}
                    </Button>
                  </RoleGate>
                </div>
              </div>
            </div>
            )}
          </SectionReveal>
          {lightboxOpen && product && (
            <ImageLightbox
              images={images}
              initialIndex={activeIndex}
              label={product.name}
              onClose={() => setLightboxOpen(false)}
            />
          )}
          {product && (
            <ProductDeleteModal
              open={deleteOpen}
              onClose={() => setDeleteOpen(false)}
              product={product}
              onDeleted={handleDeleted}
            />
          )}
        </>
      )}
    </div>
  );
};

export default ProductDetailPage;
