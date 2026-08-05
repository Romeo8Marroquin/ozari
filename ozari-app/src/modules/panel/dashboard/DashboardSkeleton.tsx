/**
 * The dashboard's shimmer bodies — one per section, shaped like the real content so the reveal is a
 * transformation rather than a swap (the `SectionReveal` doctrine: the card's own chrome stays real
 * from first paint and only its body shimmers).
 *
 * Every row carries `.card-item` so a shimmering card waves exactly like a loaded one.
 */
const Row: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`card-item animate-pulse rounded-chip bg-charcoal/[0.06] ${className}`} />
);

export const UpNextSkeleton: React.FC = () => (
  <div className="grid gap-3 lg:grid-cols-3">
    {[0, 1, 2].map((slot) => (
      <div key={slot} className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-black/[0.04]">
        <Row className="h-3 w-24" />
        <Row className="h-4 w-2/3" />
        <Row className="h-3 w-1/2" />
        <Row className="h-8 w-full" />
      </div>
    ))}
  </div>
);

export const StatsSkeleton: React.FC = () => (
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {[0, 1, 2, 3].map((slot) => (
      <div key={slot} className="flex flex-col gap-2 rounded-card bg-white p-4 ring-1 ring-black/[0.04]">
        <Row className="h-3 w-20" />
        <Row className="h-6 w-28" />
        <Row className="h-3 w-16" />
      </div>
    ))}
  </div>
);

export const ChartSkeleton: React.FC = () => (
  <div className="flex flex-col gap-3">
    <Row className="h-32 w-full" />
    <Row className="h-3 w-2/3" />
  </div>
);

export const ListSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="flex flex-col gap-3">
    {Array.from({ length: rows }, (_, index) => (
      <Row key={index} className="h-6 w-full" />
    ))}
  </div>
);
