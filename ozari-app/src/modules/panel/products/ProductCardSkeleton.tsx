// One shimmer surface, sized by the caller — the same skeleton language the rest of the panel uses
// (`animate-pulse`, disabled under reduced motion), so a loading grid reads as "loading", never as
// empty content.
const SHIMMER = 'animate-pulse bg-charcoal/10 motion-reduce:animate-none';

/**
 * The loading placeholder for a {@link ProductCard} — structurally identical to the real tile (portrait
 * image frame + body with chip, title, and a price line) so the grid keeps its shape and the swap to
 * real data lands each card exactly where its skeleton stood. Purely decorative (`aria-hidden`); the
 * grid announces its loading state.
 */
const ProductCardSkeleton: React.FC = () => (
  <div
    aria-hidden
    className="flex flex-col overflow-hidden rounded-card bg-white ring-1 ring-black/[0.04]"
  >
    <div className={`aspect-[3/4] w-full ${SHIMMER}`} />
    <div className="flex flex-1 flex-col gap-2.5 p-3.5">
      <div className={`h-3.5 w-16 rounded-chip ${SHIMMER}`} />
      <div className={`h-4 w-4/5 rounded ${SHIMMER}`} />
      <div className={`mt-1 h-4 w-1/2 rounded ${SHIMMER}`} />
    </div>
  </div>
);

export default ProductCardSkeleton;
