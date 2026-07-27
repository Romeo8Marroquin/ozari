import useBreakpoint from '@hooks/useBreakpoint';

// The panel's shared skeleton language (`animate-pulse`, disabled under reduced motion).
const SHIMMER = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

/**
 * The loading placeholder for an {@link OrderTicket} — and it mirrors the ticket's TWO responsive
 * layouts (same `useBreakpoint` decision) so the SkeletonFade crossfade is congruent on EVERY view:
 * the roomy **rail** shape at ≥ sm and the compact **stacked** shape on portrait phones. Each row's
 * real content then materialises where its skeleton stood. Purely decorative (`aria-hidden`); the
 * list announces its loading state.
 */
const OrderTicketSkeleton: React.FC = () => {
  const { isMobile } = useBreakpoint();
  const compact = isMobile !== false;

  // The shimmer pieces, placed differently per layout (mirrors OrderTicket's own who/events/chip/total).
  const whoBars = (
    <>
      <div className={`h-4 w-2/5 ${SHIMMER}`} />
      <div className={`h-3 w-3/5 ${SHIMMER}`} />
    </>
  );
  const deliveryBar = (
    <div className="flex flex-col gap-1.5">
      <div className={`h-2 w-12 ${SHIMMER}`} />
      <div className={`h-4 w-16 ${SHIMMER}`} />
    </div>
  );
  const pickupBar = (
    <div className="flex flex-col gap-1.5">
      <div className={`h-2 w-14 ${SHIMMER}`} />
      <div className={`h-3 w-20 ${SHIMMER}`} />
    </div>
  );
  const chip = <div className={`h-5 w-16 shrink-0 rounded-full ${SHIMMER}`} />;
  const total = <div className={`h-4 w-14 shrink-0 ${SHIMMER}`} />;

  return (
    <div
      aria-hidden
      className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-black/[0.04]"
    >
      {compact ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">{whoBars}</div>
            {chip}
          </div>
          <div className="flex items-end justify-between gap-x-6 border-t border-black/[0.06] pt-3">
            <div className="flex gap-x-6">
              {deliveryBar}
              {pickupBar}
            </div>
            {total}
          </div>
        </>
      ) : (
        <div className="flex items-stretch gap-5">
          <div className="flex w-28 shrink-0 flex-col justify-center gap-2 border-r border-black/[0.06] pr-4">
            {deliveryBar}
            {pickupBar}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">{whoBars}</div>
          <div className="flex shrink-0 flex-col items-end justify-center gap-2">
            {chip}
            {total}
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderTicketSkeleton;
