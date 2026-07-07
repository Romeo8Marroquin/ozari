import LogoMark from '@components/LogoMark';

/**
 * The brand tile: a cream→blossom gradient square (echoing the auth card) holding the Party Rentals
 * mark ([[LogoMark]], the hexagon + arch only — no wordmark text). Used both as the full logo lockup
 * (with the wordmark beside it) and, in the collapsed rail, as the standalone icon. The mark inherits
 * the tile's `currentColor` (charcoal), so the tile owns the look in one place.
 */
const BrandMark: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span
    aria-hidden
    // Resting shadow is two layers — a subtle drop + a *transparent* magenta glow — so it shares
    // the hover shadow's structure. Box-shadow only animates smoothly between values with the same
    // layer count, so this transparent glow layer is what lets the hover glow fade in instead of snap.
    className={`grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cream to-blossom text-charcoal shadow-[0_1px_3px_rgba(38,38,38,0.12),0_0_0_rgba(255,1,237,0)] ${className}`}
  >
    <LogoMark className="size-[88%]" />
  </span>
);

export default BrandMark;
