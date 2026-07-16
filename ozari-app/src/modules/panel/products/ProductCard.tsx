import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineCalendarDays, HiOutlineShoppingBag } from 'react-icons/hi2';
import LogoMark from '@components/LogoMark';
import { Role } from '@constants/Roles';
import { useRole } from '@hooks/useRole';
import { usePanelNavigate } from '../PanelNavContext';
import { beginProductImageMorph, estimateDetailHeroRect } from './productImageMorph';
import { saveProductsScroll } from './productsScroll';
import { formatProductPrice, primaryImageUrl } from './productPresentation';
import type { Product } from './product.types';

const KEY = 'modules.panel.products';

/**
 * The "Venta" business-type display name. The role projection deliberately sends lookup NAMES (never
 * ids), and the seeded pair Alquiler/Venta is a stable business fact — hardcoding the mapping on the
 * frontend is an owner decision (2026-07-14). Anything that isn't Venta is treated as a rental.
 */
export const SELL_BUSINESS_TYPE = 'Venta';

/**
 * The stock chip — driven entirely by **which role-gated fields are present** (the projection
 * contract), so there's no role check here:
 *  - `available` + `total` present (Admin, Alquiler) → the fleet view, SHORT on the tile ("5 de
 *    10" — the tile is space-constrained; the detail page spells out "disponibles"); "0 de 10"
 *    stays visible in amber — a fully-rented fleet is NOT gone, and the admin must see both
 *    numbers at a glance;
 *  - `available` alone (Admin on Venta) → the takeable count, or the zero wording;
 *  - else `inStock` present → a plain available / zero signal (defensive fallback — the current
 *    projection always pairs the flag with the count);
 *  - else (Client) → nothing (clients never see stock — deliberate for a rentals catalog).
 *
 * The ZERO wording is business-type-aware: a sold-out **Venta** is "Agotado" (gone until the
 * business restocks), but a fully-booked **Alquiler** is only "No disponible" — its units come
 * back, so "agotado" would lie. Unknown types take the gentler wording.
 */
const StockBadge: React.FC<{ product: Product }> = ({ product }) => {
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
      label = t(`${KEY}.stock.countOfTotalShort`, { count: availableCount, total });
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
    // `shrink-0` holds the numbers whole while the type chip yields; `max-w-full truncate` is the
    // last-resort cap so even a pathologically narrow tile clips with an ellipsis, never overlaps.
    <span
      className={`shrink-0 max-w-full truncate rounded-chip px-2 py-0.5 text-[11px] font-semibold shadow-sm backdrop-blur ${
        available ? 'bg-white/85 text-emerald-600' : 'bg-white/85 text-amber-600'
      }`}
    >
      {label}
    </span>
  );
};

/** One glass action. Wiring lands with the order/rent/buy flows (the orders epic) — the design
 *  ships now. It stops propagation so pressing it never toggles/navigates the card underneath. NO
 *  resting shadow: the actions live inside an overflow-clipped expander, where a shadow gets cut
 *  into a hard seam — a hairline border defines the light button instead, and the hover lift's
 *  shadow gets its clearance from the expander's inner padding. */
const CardAction: React.FC<{
  label: string;
  icon: React.ReactNode;
}> = ({ label, icon }) => (
  <button
    type="button"
    // TODO(order/rent/buy flows — the orders epic): navigate/confirm here; the surface is
    // design-complete. (A danger tone existed while delete lived on the card; it moved to the
    // detail page — reintroduce the tone there if a destructive action ever returns.)
    onClick={(event) => event.stopPropagation()}
    className="inline-flex cursor-pointer items-center gap-1.5 rounded-control px-2.5 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow,translate] duration-200 ease-[var(--ease-settle)] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta motion-reduce:transition-none motion-reduce:hover:translate-y-0 bg-charcoal text-white hover:bg-charcoal/90"
  >
    {icon}
    {label}
  </button>
);

// The engaged look is driven by hover (fine pointers) and focus-within (keyboard) — pure CSS, no
// state. Class fragments per concern (see the docstring):
const GLASS_ON = 'opacity-0 pointer-fine:group-hover:opacity-100 group-focus-within:opacity-100';
const SCRIM_OFF = 'opacity-100 pointer-fine:group-hover:opacity-0 group-focus-within:opacity-0';
const INK_FLIP = 'text-white pointer-fine:group-hover:text-charcoal group-focus-within:text-charcoal';
// The expanders move as ONE with the reveal — space, fade and rise all share the same 200ms settle
// clock as the rest of the card. What makes the emergence look right is WHERE it happens: while
// engaged, the info block's bottom padding migrates INSIDE the actions' clip (see `blockPadding`),
// so the concealing edge is the card's own bottom edge — the buttons rise out of the card, never
// out of an invisible shelf floating above the padding.
const EXPAND =
  'grid-rows-[0fr] opacity-0 pointer-fine:group-hover:grid-rows-[1fr] pointer-fine:group-hover:opacity-100 group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100';
const EXPAND_CONTENT =
  'transition-[translate] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none translate-y-2 pointer-fine:group-hover:translate-y-0 group-focus-within:translate-y-0';

/**
 * A catalog tile, image-forward: the photo IS the card, with ONE info block on it that
 * **transforms in place** when the card is engaged — the scrim dissolves into the frosted glass
 * behind the SAME text, which recolors white → charcoal and grows a step, while the description
 * and the role's actions EXPAND underneath (the grid-rows 0fr↔1fr trick). No duplicated copy ever
 * crossfades; the resting info *becomes* the detailed info.
 *
 * Engagement, per input:
 *  - **fine pointer**: hover previews (and retracts on leave); click NAVIGATES to the detail;
 *  - **keyboard**: the card is a real stretched button — focus previews, Enter/Space navigate;
 *  - **touch**: a tap navigates directly (no hover exists; the detail page IS the full preview).
 * The click also **begins the shared-element image morph** (see `productImageMorph.ts`): the
 * photo (tagged with its `data-morph-id`) persists as a floating clone through the page
 * transition and glides onto the detail hero — pure decoration, the navigation never waits on it.
 *
 * Role decides THE one action (a UX layer — the backend 403 is the guard): a **Client** gets the
 * consumer CTA for the product's business type — "Rentar" (Alquiler) / "Comprar" (Venta). The old
 * Employee/Admin "Ordenar" is GONE (Epic-2A): drivers can't see products at all, and the admin's
 * order-on-behalf flow is a dedicated order form in the orders epic, not a card button. A card
 * carries only the role's PRIMARY action — management verbs (edit/delete) belong to the product
 * DETAIL page, not the browse tile.
 */
const ProductCard: React.FC<{ product: Product }> = ({ product }) => {
  const { t } = useTranslation();
  const role = useRole();
  const panelNavigate = usePanelNavigate();
  const imageRef = useRef<HTMLImageElement>(null);
  const imageUrl = primaryImageUrl(product);
  const price = formatProductPrice(product);

  // Navigate through the panel's animated transition. Order matters: save the grid's scroll (the
  // return restores it), lift the morph clone off (it snapshots the photo and starts travelling
  // toward the PREDICTED hero position immediately — the click is t=0), then navigate. The REVERSE
  // landing is orchestrated by ProductsPage (`claimProductImageMorphWithin`) — a page-level concern
  // because the scroll must be restored before any card is measured.
  const openDetail = (): void => {
    saveProductsScroll();
    beginProductImageMorph(product.id, imageRef.current, estimateDetailHeroRect());
    panelNavigate(`/panel/productos/${product.id}`);
  };

  // Only the Client has a card action (see the docstring's role mapping) — an Admin browses and
  // manages from the detail page.
  const hasActions = role === Role.Client;
  const isSell = product.businessType === SELL_BUSINESS_TYPE;
  // The padding hand-off: at rest the block owns the bottom spacing; engaged, it eases to zero (in
  // step with the expansion) while the actions row carries the same spacing INSIDE the clip.
  const blockPadding = hasActions
    ? 'pb-3 pointer-fine:group-hover:pb-0 group-focus-within:pb-0'
    : 'pb-3';

  return (
    // ARIA structure: the card is a plain <article>; its primary action is a STRETCHED real
    // <button> (below) covering the whole tile, and the role actions are SIBLINGS layered above
    // it — no interactive element is ever nested inside another.
    <article
      // `@container`: the card measures ITSELF (not the viewport) — its width decides how much
      // description fits (fixed aspect ratio ⇒ width ≡ height), so the clamp adapts to whatever
      // actually sized the tile: orientation, sidebar collapse, column count, screen size.
      className="group @container relative aspect-[3/4] overflow-hidden rounded-card bg-white ring-1 ring-black/[0.04] shadow-sm transition-shadow duration-200 hover:shadow-lg motion-reduce:transition-none"
    >
      {/* The photo layer (or the brand mark), gently zooming while engaged. `data-morph-id` tags
          it as the shared element the detail hero continues (the "animation id"). */}
      {imageUrl ? (
        <img
          ref={imageRef}
          data-morph-id={product.id}
          src={imageUrl}
          alt={t(`${KEY}.imageAlt`, { name: product.name })}
          loading="lazy"
          className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-[var(--ease-settle)] group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-cream to-blossom text-charcoal/25">
          <LogoMark className="size-14" />
        </span>
      )}

      {/* Background veils, crossfading BEHIND the single info block: the readable-over-any-photo
          scrim at rest, the frosted glass while engaged. `-inset-px` + own radius on the glass:
          backdrop-filter leaves a 1px unblurred fringe at a rounded clip's corners otherwise. */}
      <div
        aria-hidden
        className={`absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 via-black/25 to-transparent transition-opacity duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${SCRIM_OFF}`}
      />
      <div
        aria-hidden
        className={`absolute -inset-px rounded-card bg-white/55 backdrop-blur-sm transition-opacity duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${GLASS_ON}`}
      />

      {/* THE primary action: a real button stretched over the whole tile (native Enter/Space,
          real focus semantics). It sits ABOVE the veils/photo and BELOW the info layer; the info
          layer is pointer-transparent except the action buttons, so any tap on the card that
          isn't an action lands here — and NAVIGATES to the product's detail page. */}
      <button
        type="button"
        aria-label={t(`${KEY}.card.viewDetails`, { name: product.name })}
        onClick={openDetail}
        className="absolute inset-0 z-[1] cursor-pointer rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
      />

      {/* Floating chips: what it is (left) and whether it's available (right, role-gated). ONE
          flex row instead of two absolutely-pinned corners, so they can NEVER overlap on a narrow
          tile: the row lays them side by side with a fixed gap, the type chip yields first
          (truncates — its full name lives on the detail anyway) and the stock badge, already the
          short "5 de 5" form, holds its numbers. They stay put in both states — no duplicated
          stock line on the glass. Pointer-transparent so taps on them reach the stretched button. */}
      <div className="pointer-events-none absolute inset-x-2 top-2 z-[2] flex items-start justify-between gap-2">
        <span className="min-w-0 truncate rounded-chip bg-white/85 px-2 py-0.5 text-[11px] font-medium text-charcoal/70 shadow-sm backdrop-blur">
          {product.businessType}
        </span>
        <StockBadge product={product} />
      </div>

      {/* THE single info block — its text transforms in place (color + size), and the detail rows
          grow open underneath it. Everything moves together on the same 200ms settle curve.
          Compact rhythm (no gaps beyond the type's own leading) so the expanded block stays clear
          of the top chips even on small phone tiles. Bottom padding is the hand-off variable. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex flex-col px-3 pt-3 transition-[padding] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${blockPadding}`}
      >
        <span
          className={`text-[11px] font-medium uppercase tracking-wide transition-colors duration-200 motion-reduce:transition-none text-white/75 pointer-fine:group-hover:text-charcoal/50 group-focus-within:text-charcoal/50`}
        >
          {product.category}
        </span>
        {/* Weight is EXCLUSIVE per state (never a base font-semibold + engaged font-bold pair):
            same-specificity utilities resolve by stylesheet order, which made engaged states'
            weights differ. Hovered and focused must be pixel-identical. */}
        <h3
          className={`line-clamp-2 leading-snug transition-[color,font-size] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${INK_FLIP} text-base font-semibold pointer-fine:group-hover:text-lg pointer-fine:group-hover:font-bold group-focus-within:text-lg group-focus-within:font-bold`}
        >
          {product.name}
        </h3>

        {/* The description grows open between the name and the price. Its line budget follows the
            CARD's own width (container queries — see `@container` on the article), so a tile
            shrunk by rotation or an expanded sidebar drops lines, and a roomy desktop tile gains
            them — never climbing into the top chips (line-clamp ellipsizes with "…" itself). */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${EXPAND}`}
        >
          <div className="overflow-hidden">
            <p
              // Steeper than +1 per tier ON PURPOSE: the tile grows in BOTH dimensions, so each
              // width step buys several line-heights. These are MAXIMA — short descriptions stay
              // short; only long ones spend the budget (and still ellipsize past it).
              className={`line-clamp-1 pb-0.5 pt-0.5 text-xs leading-snug text-charcoal/70 @min-[13rem]:line-clamp-5 @min-[16rem]:line-clamp-[9] @min-[19rem]:line-clamp-[13] ${EXPAND_CONTENT}`}
            >
              {product.description ?? t(`${KEY}.card.noDescription`)}
            </p>
          </div>
        </div>

        {price && (
          <span
            className={`font-bold transition-[color,font-size] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${INK_FLIP} text-base pointer-fine:group-hover:text-lg group-focus-within:text-lg`}
          >
            {price}
          </span>
        )}

        {/* The role's actions grow open under the price, emerging from the card's bottom edge. */}
        {hasActions && (
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${EXPAND}`}
          >
            <div className="overflow-hidden">
              {/* `pb-3` = the block's handed-off bottom spacing, now INSIDE the clip (also the
                  clearance so the hover lift's shadow isn't sheared); `px-1 -mx-1` for lateral
                  shadow room. The row rises with its opening space — one motion. It re-enables
                  pointer events (the info layer is otherwise tap-transparent to the stretched
                  button underneath). */}
              <div className={`pointer-events-auto flex flex-wrap gap-2 px-1 -mx-1 pb-3 pt-1.5 ${EXPAND_CONTENT}`}>
                {isSell ? (
                  <CardAction
                    label={t(`${KEY}.card.actions.buy`)}
                    icon={<HiOutlineShoppingBag aria-hidden className="size-3.5" />}
                  />
                ) : (
                  <CardAction
                    label={t(`${KEY}.card.actions.rent`)}
                    icon={<HiOutlineCalendarDays aria-hidden className="size-3.5" />}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  );
};

export default ProductCard;
