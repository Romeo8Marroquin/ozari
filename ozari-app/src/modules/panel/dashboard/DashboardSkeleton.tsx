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

/**
 * The queue's shimmer is ONE ROW, exactly like the folded queue it becomes (`UpNextQueue`): the same
 * container-query columns, and each extra slot exists only at the width that gives it a column — so
 * a phone shimmers one card, not three stacked ones that then collapse to one.
 */
const UP_NEXT_SLOTS = ['flex', 'hidden @min-[36rem]:flex', 'hidden @min-[56rem]:flex', 'hidden @min-[84rem]:flex'];

export const UpNextSkeleton: React.FC = () => (
  <div className="flex flex-col gap-3">
    <div className="grid gap-3 @min-[36rem]:grid-cols-2 @min-[56rem]:grid-cols-3 @min-[84rem]:grid-cols-4">
      {UP_NEXT_SLOTS.map((display) => (
        <div key={display} className={`${display} flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-black/[0.04]`}>
          <Row className="h-3 w-24" />
          <Row className="h-4 w-2/3" />
          <Row className="h-3 w-1/2" />
          <Row className="h-8 w-full" />
        </div>
      ))}
    </div>
    {/* The "Mañana" strip (`TomorrowSummary`): one short row under the queue. */}
    <div className="flex items-center gap-3 rounded-card bg-white px-4 py-3 ring-1 ring-black/[0.04]">
      <Row className="size-7 shrink-0" />
      <div className="flex grow flex-col gap-1.5">
        <Row className="h-3 w-16" />
        <Row className="h-2.5 w-28" />
      </div>
      <Row className="h-4 w-24" />
    </div>
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
