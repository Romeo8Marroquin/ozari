// The panel's shared skeleton language (`animate-pulse`, disabled under reduced motion).
const SHIMMER = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

/**
 * The loading placeholder for an {@link OrderTicket} — the same three-column ticket shape (time
 * rail / client / status + total), so the resolve barely moves: each row materialises where its
 * skeleton stood. Purely decorative (`aria-hidden`); the list announces its loading state.
 */
const OrderTicketSkeleton: React.FC = () => (
  <div
    aria-hidden
    className="flex items-center gap-4 rounded-card bg-white p-4 ring-1 ring-black/[0.04]"
  >
    <div className="flex w-20 shrink-0 flex-col items-center gap-1.5 border-r border-black/[0.06] pr-3 sm:w-24 sm:pr-4">
      <div className={`h-4 w-14 ${SHIMMER}`} />
      <div className={`h-3 w-10 ${SHIMMER}`} />
    </div>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className={`h-4 w-2/5 ${SHIMMER}`} />
      <div className={`h-3 w-3/5 ${SHIMMER}`} />
    </div>
    <div className="flex shrink-0 flex-col items-end gap-2">
      <div className={`h-5 w-16 rounded-full ${SHIMMER}`} />
      <div className={`h-4 w-14 ${SHIMMER}`} />
    </div>
  </div>
);

export default OrderTicketSkeleton;
