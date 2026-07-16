// One shimmer surface, sized by the caller — the same skeleton language the rest of the panel uses
// (`animate-pulse`, disabled under reduced motion), so a loading grid reads as "loading", never as
// empty content.
const SHIMMER = 'animate-pulse bg-charcoal/10 motion-reduce:animate-none';

/**
 * The loading placeholder for a {@link ProductCard} — the same image-forward shape (a full-bleed
 * portrait frame with the essentials on a bottom scrim), so the crossfade to real data barely
 * moves: each card materialises exactly where its skeleton stood. Purely decorative
 * (`aria-hidden`); the grid announces its loading state.
 */
const ProductCardSkeleton: React.FC = () => (
  <div
    aria-hidden
    className="relative aspect-[3/4] overflow-hidden rounded-card bg-white ring-1 ring-black/[0.04]"
  >
    <div className={`absolute inset-0 ${SHIMMER}`} />
    <div className={`absolute left-2 top-2 h-5 w-14 rounded-chip bg-white/70`} />
    <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3">
      <div className="h-3 w-16 rounded bg-white/60" />
      <div className="h-4 w-4/5 rounded bg-white/70" />
      <div className="h-4 w-2/5 rounded bg-white/70" />
    </div>
  </div>
);

export default ProductCardSkeleton;
