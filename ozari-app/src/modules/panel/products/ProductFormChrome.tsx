/**
 * The product form's STATIC chrome, shared by the live form (`ProductForm`) and the edit page's
 * cold-load stand-in (`ProductFormSkeleton`): the section card shell and the per-section shimmer
 * bodies. Extracted so a loading state can render the REAL structure — titles, descriptions, card
 * layout are known at build time; only the value-dependent bodies shimmer (the add-product
 * loading doctrine).
 */

const SKELETON = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

/** A section card matching the settings surface language — each one is a `.reveal-block`. */
export const FormSection: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <section className="reveal-block min-w-0 rounded-card border border-charcoal/[0.07] bg-white px-5 py-5 shadow-sm sm:px-6">
    <h3 className="text-base font-semibold text-charcoal">{title}</h3>
    <p className="mb-5 mt-1 text-sm leading-relaxed text-charcoal/55">{description}</p>
    {children}
  </section>
);

// ── Skeleton BODIES, one per section (the card chrome — title/description — stays REAL while
// loading; only the data-dependent body shimmers). Shapes mirror the real fields so each card's
// reveal barely has to morph. Stateless: rendered by `SectionReveal` in both layers, and composed
// whole by `ProductFormSkeleton` for the edit page's product load. ──────────────────────────────

export const InfoSkeleton: React.FC = () => (
  <div className="flex flex-col gap-5">
    <span aria-hidden className={`block h-11 w-full ${SKELETON}`} />
    <span aria-hidden className={`block h-24 w-full ${SKELETON}`} />
    <div className="grid gap-5 sm:grid-cols-2">
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
    </div>
    <span aria-hidden className={`block h-11 w-full ${SKELETON}`} />
  </div>
);

export const PhotosSkeleton: React.FC = () => (
  <div className="flex flex-col gap-4">
    <span aria-hidden className={`block h-36 w-full rounded-control ${SKELETON}`} />
    <span aria-hidden className={`block h-3 w-24 self-end ${SKELETON}`} />
  </div>
);

export const PricingSkeleton: React.FC = () => (
  <div className="flex flex-col gap-5">
    <div className="grid gap-5 sm:grid-cols-2">
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
    </div>
    <div className="grid gap-5 sm:grid-cols-2">
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
    </div>
  </div>
);

export const DetailsSkeleton: React.FC = () => (
  <span aria-hidden className={`block h-9 w-40 rounded-control ${SKELETON}`} />
);
