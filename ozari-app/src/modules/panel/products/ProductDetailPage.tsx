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
import MorphSwap from '@components/MorphSwap';
import { headerTitleOut, staggerIn, staggerOut } from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import SlotSwap from '../SlotSwap';
import useMorphOnChange from '../useMorphOnChange';
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
import { formatHeadlinePrice, formatMoney, primaryImageIndex } from './productPresentation';
import { effectivePricing, matchVariant, photoSetFor, variantMatchesPicks } from './productVariations';
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
    // A variation pick rewrites the label (cross-fade + width morph) and may flip the tone (CSS).
    <p
      className={`reveal-item inline-flex w-fit items-center rounded-chip px-2.5 py-1 text-xs font-semibold transition-colors duration-200 motion-reduce:transition-none ${
        available ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
      }`}
    >
      <MorphSwap swapKey={label}>{label}</MorphSwap>
    </p>
  );
};

/**
 * The gallery column: the hero's FRAME is the grid card's own 3:4 (owner, 2026-10-29) — one standard
 * frame for a product photo across the catalog — and the photo is shown WHOLE inside it
 * (`object-contain`), letterboxed on the frame's white, so a tall chair is never cropped and
 * switching images never changes the layout. At the width of its column a 3:4 frame can be taller
 * than the screen (a 492px lg column → 656px), so the WIDTH is capped from the viewport HEIGHT:
 * `(100svh − 12rem) × 3/4` leaves room for the header, the page padding and the back row, with a
 * 14rem floor for a landscape phone. Capping the width (never the height) is what keeps the frame
 * 3:4 at every size, and `svh` (not `dvh`) keeps it still while a mobile URL bar slides. The
 * thumbnails share the column, so they stay aligned under the frame. `productImageMorph`'s
 * `estimateDetailHeroRect` mirrors these numbers.
 */
const PRODUCT_HERO_COLUMN = 'mx-auto w-full max-w-[max(14rem,calc((100svh_-_12rem)*0.75))]';

/** The shimmering placeholder for a COLD load (a deep link — arriving from the grid is cache-warm).
 *  Its hero block is the real frame, so nothing moves when the data lands. */
const DetailSkeleton: React.FC = () => (
  <div className="grid gap-6 lg:grid-cols-2 lg:gap-10" aria-hidden>
    <div
      className={`${PRODUCT_HERO_COLUMN} reveal-item aspect-[3/4] animate-pulse rounded-card bg-charcoal/[0.06]`}
    />
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
  // The visitor's pick per option (option order; `null` = not picked). Picks only change WHICH
  // photos the gallery shows and which variation's price/stock the info speaks for — the hero
  // frame never changes.
  const [rawPicks, setRawPicks] = useState<(number | null)[]>([]);
  const options = useMemo(() => product?.options ?? [], [product]);
  const picks = useMemo(() => options.map((_, index) => rawPicks[index] ?? null), [options, rawPicks]);
  const images = useMemo(() => (product ? photoSetFor(product, picks) : []), [product, picks]);
  const activeIndex = selectedIndex ?? primaryImageIndex({ images });
  const activeImage = images[activeIndex] ?? images[0];
  const allPicked = options.length > 0 && picks.every((pick) => pick !== null);
  const variant = product && allPicked ? matchVariant(product, picks) : undefined;
  // The info a pick rewrites eases its height as one region (see the render).
  const infoRegion = useMorphOnChange(picks.join(','));

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
  // A pick (or un-pick — pressing the chosen value again) that brings a different photo set
  // crossfades to the new set's primary, through the same ghost layer as a thumbnail switch.
  const pick = (optionIndex: number, valueId: number): void => {
    /* v8 ignore next -- the pickers only render alongside the product */
    if (!product) return;
    const next = picks.map((current, index) =>
      index === optionIndex ? (current === valueId ? null : valueId) : current,
    );
    setRawPicks(next);
    const nextImages = photoSetFor(product, next);
    if (nextImages === images) return;
    setSelectedIndex(null);
    const incoming = nextImages[primaryImageIndex({ images: nextImages })];
    // Only when a photo is both leaving AND arriving: the ghost needs an incoming hero to fade over.
    if (activeImage && incoming && incoming.url !== activeImage.url) setGhostImageUrl(activeImage.url);
  };
  // BOTH layers tween: the photo is CONTAINED (letterboxed), so wherever the incoming photo does not
  // reach — the sides, when a wide photo gives way to a tall one — the ghost shows through, and left
  // at full opacity it would vanish in one frame when it unmounts. Fading it out on the same clock
  // makes the whole frame one crossfade.
  const ghostImage = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    if (!ghostImageUrl) return;
    const incoming = heroImage.current;
    const outgoing = ghostImage.current;
    /* v8 ignore next -- a ghost only exists after a switch, when both layers are mounted */
    if (!incoming || !outgoing) return;
    const seconds = prefersReducedMotion() ? 0 : 0.22;
    const tween = gsap.fromTo(
      incoming,
      { autoAlpha: 0 },
      {
        autoAlpha: 1,
        duration: seconds,
        ease: 'power2.inOut',
        // A switch mid-fade retargets from the frame on screen: the old tween is killed, never left
        // to land on its own target over the new one.
        overwrite: true,
        clearProps: 'opacity,visibility',
        onComplete: () => setGhostImageUrl(null),
      },
    );
    const fadeOut = gsap.fromTo(
      outgoing,
      { autoAlpha: 1 },
      { autoAlpha: 0, duration: seconds, ease: 'power2.inOut', overwrite: true },
    );
    return () => {
      tween.kill();
      fadeOut.kill();
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
  // What the info column speaks for: the picked VARIATION (its values arrive effective, stock
  // included for the Admin) once every option is picked; the product — "Desde" its lowest price —
  // until then.
  const shown: Product | null | undefined =
    product && variant
      ? {
          ...product,
          ...effectivePricing(product, variant),
          available: variant.available,
          total: variant.total,
          inStock: variant.inStock,
          variants: undefined,
        }
      : product;
  const headline = shown ? formatHeadlinePrice(shown) : null;
  const headlineText =
    headline && (headline.from ? t(`${KEY}.card.priceFrom`, { price: headline.price }) : headline.price);
  const pickNote = allPicked ? (variant ? variant.label : t(`${DKEY}.notOffered`)) : t(`${DKEY}.pickHint`);
  const description = shown?.description ?? t(`${KEY}.card.noDescription`);

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
            {product && shown && (
              <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
              {/* ── Gallery ─────────────────────────────────────────────────────────────── */}
              {/* No column gap: the strip carries its own top padding, so an EMPTY strip takes no
                  room at all and its height ease covers the spacing too. */}
              <div className={`${PRODUCT_HERO_COLUMN} flex flex-col`}>
                {/* The hero — the morph's TARGET (same `data-morph-id` as the card photo). A
                    fixed 3:4 frame showing the WHOLE photo (see `PRODUCT_HERO_COLUMN`). */}
                <div
                  ref={heroWrap}
                  data-morph-id={id}
                  className="reveal-item relative aspect-[3/4] overflow-hidden rounded-card bg-white ring-1 ring-black/[0.04] shadow-sm"
                >
                  {/* The GHOST layer (the outgoing image) sits under the incoming one during the
                      crossfade — rendered first so the real hero stays on top. Same fit as the
                      hero, so the crossfade never changes the photo's size. */}
                  {ghostImageUrl && (
                    <img
                      ref={ghostImage}
                      aria-hidden
                      src={ghostImageUrl}
                      className="absolute inset-0 size-full object-contain"
                    />
                  )}
                  {activeImage ? (
                    <>
                      <img
                        ref={heroImage}
                        data-testid="product-hero-image"
                        src={activeImage.url}
                        alt={t(`${KEY}.imageAlt`, { name: product.name })}
                        className="absolute inset-0 size-full object-contain"
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
                {/* The thumbnails SWAP as one strip when a pick brings another photo set: the old
                    strip leaves, the box eases to the new one's height (appearing, vanishing or
                    wrapping onto another row moves everything below it), the new strip slides in —
                    SlotSwap. Keyed by the set's photo ids, so a refetch of the same set is still. */}
                <SlotSwap
                  swapKey={images.length > 1 ? images.map((image) => image.id).join(',') : 'none'}
                  className="reveal-item"
                >
                  {images.length > 1 && (
                  <div className="flex flex-wrap gap-2 pt-3">
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
                </SlotSwap>
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
                {headlineText && (
                  <p className="reveal-item text-xl font-bold text-charcoal">
                    <MorphSwap swapKey={headlineText}>{headlineText}</MorphSwap>
                  </p>
                )}
                {/* What a pick rewrites lives in ONE region: its height eases (the description
                    re-wrapping, a note's line count) while each text cross-fades in place, so the
                    details and the actions below glide instead of jumping. */}
                <div ref={infoRegion} className="flex flex-col gap-4">

                {/* The option pickers: one chip row per option. A value no offered variation
                    pairs with the other picks stays pressable (so the visitor can switch
                    straight across) but reads muted; the combination then says it is not offered. */}
                {options.length > 0 && (
                  <div className="reveal-item flex flex-col gap-3">
                    {options.map((option, optionIndex) => (
                      <div
                        key={option.id}
                        role="group"
                        aria-label={t(`${DKEY}.options`, { name: option.name })}
                        className="flex min-w-0 flex-col gap-1.5"
                      >
                        <span className="text-xs font-semibold uppercase tracking-wide text-charcoal/50">
                          {option.name}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {option.values.map((value) => {
                            const pressed = picks[optionIndex] === value.id;
                            const trial = picks.map((current, index) =>
                              index === optionIndex ? value.id : current,
                            );
                            /* v8 ignore next -- `?? []`: a product with options always carries variants */
                            const reachable = (product.variants ?? []).some((candidate) =>
                              variantMatchesPicks(product, candidate, trial),
                            );
                            return (
                              <button
                                key={value.id}
                                type="button"
                                aria-pressed={pressed}
                                onClick={() => pick(optionIndex, value.id)}
                                className={`max-w-full cursor-pointer truncate rounded-chip px-3 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta motion-reduce:transition-none ${
                                  pressed
                                    ? 'bg-charcoal text-white'
                                    : `bg-charcoal/[0.05] text-charcoal/80 hover:bg-charcoal/[0.09] ${reachable ? '' : 'opacity-45'}`
                                }`}
                              >
                                {value.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <p
                      className={`text-xs transition-colors duration-200 motion-reduce:transition-none ${allPicked && !variant ? 'text-amber-700' : 'text-charcoal/50'}`}
                    >
                      <MorphSwap swapKey={pickNote} block>
                        {pickNote}
                      </MorphSwap>
                    </p>
                  </div>
                )}
                <StockLine product={shown} />
                {/* Field-presence gated (the projection only sends it to Admin): what the business
                    charges if the product is lost or damaged. Captured on the create form — this
                    is where the admin sees it again. */}
                {shown.replacementPrice !== undefined && (
                  <p className="reveal-item text-sm text-charcoal/70">
                    <span className="font-medium text-charcoal/60">{t(`${DKEY}.replacementPrice`)}: </span>
                    <MorphSwap swapKey={shown.replacementPrice}>
                      {formatMoney(shown.replacementPrice, product.currency.symbol)}
                    </MorphSwap>
                  </p>
                )}
                {/* The refundable deposit per unit — a public commercial condition (every role
                    receives it), shown beside the price because the client pays it up front. It is
                    NOT part of the price: it comes back when the goods do. */}
                {shown.securityDeposit !== undefined && (
                  <p className="reveal-item text-sm text-charcoal/70">
                    <span className="font-medium text-charcoal/60">{t(`${DKEY}.securityDeposit`)}: </span>
                    <MorphSwap swapKey={shown.securityDeposit}>
                      {formatMoney(shown.securityDeposit, product.currency.symbol)}
                    </MorphSwap>
                    <span className="text-charcoal/50"> · {t(`${DKEY}.securityDepositNote`)}</span>
                  </p>
                )}
                <div className="reveal-item flex flex-col gap-1.5">
                  <h3 className="text-sm font-semibold text-charcoal">{t(`${DKEY}.descriptionTitle`)}</h3>
                  <MorphSwap swapKey={description} block className="text-sm leading-relaxed text-charcoal/70">
                    {description}
                  </MorphSwap>
                </div>
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
