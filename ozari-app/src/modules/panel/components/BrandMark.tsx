/**
 * The brand tile: a cream→blossom gradient square (echoing the auth card) holding a monogram.
 * Works as the full logo lockup (with the wordmark beside it) and as the collapsed icon.
 * TODO: swap the monogram for the real square brand mark when one is available.
 */
const BrandMark: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span
    aria-hidden
    className={`grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cream to-blossom shadow-sm ${className}`}
  >
    <span className="text-base font-extrabold leading-none text-charcoal">P</span>
  </span>
);

export default BrandMark;
