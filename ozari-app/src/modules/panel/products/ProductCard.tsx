import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlinePencilSquare, HiOutlineShoppingBag, HiOutlineTrash } from 'react-icons/hi2';
import LogoMark from '@components/LogoMark';
import { Role } from '@constants/Roles';
import { useRole } from '@hooks/useRole';
import { formatProductPrice, primaryImageUrl } from './productPresentation';
import type { Product } from './product.types';

const KEY = 'modules.panel.products';

/**
 * The stock chip — driven entirely by **which role-gated fields are present** (the projection
 * contract), so there's no role check here:
 *  - `quantity` present (Admin) → the exact count, or "Agotado" at zero;
 *  - else `inStock` present (Employee) → a plain available / out signal;
 *  - else (Client) → nothing (clients never see stock — deliberate for a rentals catalog).
 */
const StockBadge: React.FC<{ product: Product }> = ({ product }) => {
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
    <span
      className={`inline-flex shrink-0 items-center rounded-chip px-2 py-0.5 text-[11px] font-semibold shadow-sm backdrop-blur ${
        available ? 'bg-white/85 text-emerald-600' : 'bg-white/85 text-amber-600'
      }`}
    >
      {label}
    </span>
  );
};

/** One glass action. Wiring lands with the edit/delete/order flows — the design ships now. It
 *  stops propagation so pressing it never toggles/navigates the card underneath. NO resting
 *  shadow: the actions live inside an overflow-clipped expander, where a shadow gets cut into a
 *  hard seam — a hairline border defines the light button instead, and the hover lift's shadow
 *  gets its clearance from the expander's inner padding. */
const CardAction: React.FC<{
  label: string;
  icon: React.ReactNode;
  tone?: 'primary' | 'danger';
}> = ({ label, icon, tone = 'primary' }) => (
  <button
    type="button"
    // TODO(edit/delete/order flows): navigate/confirm here; the surface is design-complete.
    onClick={(event) => event.stopPropagation()}
    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-control px-2.5 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow,translate] duration-200 ease-[var(--ease-settle)] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
      tone === 'danger'
        ? 'border border-black/[0.07] bg-white/90 text-red-600 hover:bg-red-50'
        : 'bg-charcoal text-white hover:bg-charcoal/90'
    }`}
  >
    {icon}
    {label}
  </button>
);

/**
 * A catalog tile, image-forward: the photo IS the card, with ONE info block on it that
 * **transforms in place** when the card is engaged — the scrim dissolves into the frosted glass
 * behind the SAME text, which recolors white → charcoal and grows a step, while the description
 * and the role's actions EXPAND underneath (the grid-rows 0fr↔1fr trick). No duplicated copy ever
 * crossfades; the resting info *becomes* the detailed info.
 *
 * Engagement, per input:
 *  - **fine pointer**: hover (and it retracts on leave);
 *  - **keyboard**: the card itself is focusable (`role="button"`, labelled "view details") — focus
 *    reveals, Tab reaches the actions, blur retracts;
 *  - **touch**: first TAP reveals (there is no hover), tapping elsewhere blurs it closed — and the
 *    tap will navigate to the detail view once that page exists (same TODO as the actions).
 * Role decides the actions (a UX layer — the backend 403 is the guard): Admin → edit/delete,
 * Client → order, Employee → information only.
 */
const ProductCard: React.FC<{ product: Product }> = ({ product }) => {
  const { t } = useTranslation();
  const role = useRole();
  const [revealed, setRevealed] = useState(false);
  const imageUrl = primaryImageUrl(product);
  const price = formatProductPrice(product);

  const toggle = (): void => setRevealed((current) => !current);
  const onBlur = (event: React.FocusEvent<HTMLElement>): void => {
    // Retract when focus leaves the whole card (tap/click elsewhere on touch, Tab away on keys).
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRevealed(false);
  };

  // The engaged look is driven three ways at once: pinned state (tap/click/Enter), pointer hover
  // (fine pointers only), and focus-within (keyboard). Class fragments per concern:
  const glassOn = revealed
    ? 'opacity-100'
    : 'opacity-0 pointer-fine:group-hover:opacity-100 group-focus-within:opacity-100';
  const scrimOff = revealed
    ? 'opacity-0'
    : 'opacity-100 pointer-fine:group-hover:opacity-0 group-focus-within:opacity-0';
  const inkFlip = revealed
    ? 'text-charcoal'
    : 'text-white pointer-fine:group-hover:text-charcoal group-focus-within:text-charcoal';
  // The expanders move as ONE with the reveal — space, fade and rise all share the same 200ms
  // settle clock as the rest of the card (sequenced/delayed variants were tried and read worse:
  // the buttons felt like they popped on their own). What makes the emergence look right is WHERE
  // it happens: while engaged, the info block's bottom padding migrates INSIDE the actions' clip
  // (see `blockPadding`), so the concealing edge is the card's own bottom edge — the buttons rise
  // out of the card, never out of an invisible shelf floating above the padding.
  const expand = revealed
    ? 'grid-rows-[1fr] opacity-100'
    : 'grid-rows-[0fr] opacity-0 pointer-fine:group-hover:grid-rows-[1fr] pointer-fine:group-hover:opacity-100 group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100';
  const expandContent = `transition-[translate] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${
    revealed
      ? 'translate-y-0'
      : 'translate-y-2 pointer-fine:group-hover:translate-y-0 group-focus-within:translate-y-0'
  }`;
  const hasActions = role === Role.Admin || role === Role.Client;
  // The padding hand-off: at rest the block owns the bottom spacing; engaged, it eases to zero (in
  // step with the expansion) while the actions row carries the same spacing INSIDE the clip.
  const blockPadding = hasActions
    ? revealed
      ? 'pb-0'
      : 'pb-3 pointer-fine:group-hover:pb-0 group-focus-within:pb-0'
    : 'pb-3';

  return (
    // ARIA structure: the card is a plain <article>; its primary action is a STRETCHED real
    // <button> (below) covering the whole tile, and the role actions are SIBLINGS layered above
    // it — no interactive element is ever nested inside another. `onBlur` lives here because
    // React's synthetic blur bubbles: focus leaving ANY of the card's controls retracts it.
    <article
      onBlur={onBlur}
      // `@container`: the card measures ITSELF (not the viewport) — its width decides how much
      // description fits (fixed aspect ratio ⇒ width ≡ height), so the clamp adapts to whatever
      // actually sized the tile: orientation, sidebar collapse, column count, screen size.
      className="group @container relative aspect-[3/4] overflow-hidden rounded-card bg-white ring-1 ring-black/[0.04] shadow-sm transition-shadow duration-200 hover:shadow-lg motion-reduce:transition-none"
    >
      {/* The photo layer (or the brand mark), gently zooming while engaged. */}
      {imageUrl ? (
        <img
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
        className={`absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 via-black/25 to-transparent transition-opacity duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${scrimOff}`}
      />
      <div
        aria-hidden
        className={`absolute -inset-px rounded-card bg-white/55 backdrop-blur-sm transition-opacity duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${glassOn}`}
      />

      {/* THE primary action: a real button stretched over the whole tile (native Enter/Space,
          real focus semantics). It sits ABOVE the veils/photo and BELOW the info layer; the info
          layer is pointer-transparent except the action buttons, so any tap on the card that
          isn't an action lands here. Becomes the navigation to the detail view when it exists. */}
      <button
        type="button"
        aria-label={t(`${KEY}.card.viewDetails`, { name: product.name })}
        aria-expanded={revealed}
        onClick={toggle}
        className="absolute inset-0 z-[1] cursor-pointer rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
      />

      {/* Floating chips: what it is (top-left) and whether it's available (top-right, role-gated).
          They stay put in both states — no duplicated stock line on the glass. Pointer-transparent
          (non-interactive) so taps on them reach the stretched button. */}
      <span className="pointer-events-none absolute left-2 top-2 z-[2] rounded-chip bg-white/85 px-2 py-0.5 text-[11px] font-medium text-charcoal/70 shadow-sm backdrop-blur">
        {product.businessType}
      </span>
      <span className="pointer-events-none absolute right-2 top-2 z-[2] flex">
        <StockBadge product={product} />
      </span>

      {/* THE single info block — its text transforms in place (color + size), and the detail rows
          grow open underneath it. Everything moves together on the same 200ms settle curve.
          Compact rhythm (no gaps beyond the type's own leading) so the expanded block stays clear
          of the top chips even on small phone tiles. Bottom padding is the hand-off variable. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex flex-col px-3 pt-3 transition-[padding] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${blockPadding}`}
      >
        <span
          className={`text-[11px] font-medium uppercase tracking-wide transition-colors duration-200 motion-reduce:transition-none ${
            revealed
              ? 'text-charcoal/50'
              : 'text-white/75 pointer-fine:group-hover:text-charcoal/50 group-focus-within:text-charcoal/50'
          }`}
        >
          {product.category}
        </span>
        {/* Weight is EXCLUSIVE per state (never a base font-semibold + engaged font-bold pair):
            same-specificity utilities resolve by stylesheet order, which made the pinned state's
            weight differ from the hovered one. Pinned and hovered must be pixel-identical. */}
        <h3
          className={`line-clamp-2 leading-snug transition-[color,font-size] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${inkFlip} ${
            revealed
              ? 'text-lg font-bold'
              : 'text-base font-semibold pointer-fine:group-hover:text-lg pointer-fine:group-hover:font-bold group-focus-within:text-lg group-focus-within:font-bold'
          }`}
        >
          {product.name}
        </h3>

        {/* The description grows open between the name and the price. Its line budget follows the
            CARD's own width (container queries — see `@container` on the article), so a tile
            shrunk by rotation or an expanded sidebar drops lines, and a roomy desktop tile gains
            them — never climbing into the top chips (line-clamp ellipsizes with "…" itself). */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${expand}`}
        >
          <div className="overflow-hidden">
            <p
              // Steeper than +1 per tier ON PURPOSE: the tile grows in BOTH dimensions, so each
              // width step buys several line-heights. These are MAXIMA — short descriptions stay
              // short; only long ones spend the budget (and still ellipsize past it).
              className={`line-clamp-1 pb-0.5 pt-0.5 text-xs leading-snug text-charcoal/70 @min-[13rem]:line-clamp-5 @min-[16rem]:line-clamp-[9] @min-[19rem]:line-clamp-[13] ${expandContent}`}
            >
              {product.description ?? t(`${KEY}.card.noDescription`)}
            </p>
          </div>
        </div>

        {price && (
          <span
            className={`font-bold transition-[color,font-size] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${inkFlip} ${
              revealed
                ? 'text-lg'
                : 'text-base pointer-fine:group-hover:text-lg group-focus-within:text-lg'
            }`}
          >
            {price}
          </span>
        )}

        {/* The role's actions grow open under the price, emerging from the card's bottom edge. */}
        {hasActions && (
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${expand}`}
          >
            <div className="overflow-hidden">
              {/* `pb-3` = the block's handed-off bottom spacing, now INSIDE the clip (also the
                  clearance so the hover lift's shadow isn't sheared); `px-1 -mx-1` for lateral
                  shadow room. The row rises with its opening space — one motion. It re-enables
                  pointer events (the info layer is otherwise tap-transparent to the stretched
                  button underneath). */}
              <div className={`pointer-events-auto flex flex-wrap gap-2 px-1 -mx-1 pb-3 pt-1.5 ${expandContent}`}>
                {role === Role.Admin && (
                  <>
                    <CardAction
                      label={t(`${KEY}.card.actions.edit`)}
                      icon={<HiOutlinePencilSquare aria-hidden className="size-3.5" />}
                    />
                    <CardAction
                      label={t(`${KEY}.card.actions.delete`)}
                      tone="danger"
                      icon={<HiOutlineTrash aria-hidden className="size-3.5" />}
                    />
                  </>
                )}
                {role === Role.Client && (
                  <CardAction
                    label={t(`${KEY}.card.actions.order`)}
                    icon={<HiOutlineShoppingBag aria-hidden className="size-3.5" />}
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
