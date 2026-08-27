import {
  LOGO_MARK_PATHS,
  LOGO_MARK_STROKE_WIDTH,
  LOGO_MARK_TRANSFORM,
  LOGO_MARK_VIEWBOX,
} from './logoMarkPaths';

/**
 * The Party Rentals brand mark — the hexagon + arch only, with the "PARTY"/"RENTALS" wordmarks
 * that surround it in the full `logo.svg` removed, and the viewBox tightened to the mark's exact
 * bounds (measured via getBBox). Inline SVG (not an <img>) so it inherits `currentColor`, stays
 * crisp at every size, and adds no network request. Purely decorative: the wrapping element supplies
 * the accessible name, so this is `aria-hidden`.
 *
 * Shared across the app (panel chrome via `BrandMark`, the auth cards, the error screens) — the one
 * place the isotype lives. Use this instead of cropping the wordmark `logo.svg` (which clips the tip).
 *
 * The GEOMETRY lives in `logoMarkPaths.ts` because a generated PDF draws the same mark through
 * react-pdf's own SVG primitives; sharing the data is what keeps the document's logo from drifting
 * away from the app's.
 */
const LogoMark: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    className={className}
    viewBox={LOGO_MARK_VIEWBOX}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* The source paths are filled outlines that render sub-pixel-thin at this size, so we add a
        same-color stroke to fatten the visible lines. It's in viewBox units, so the weight scales
        proportionally at every render size (expanded tile, collapsed rail, drawer, error card). */}
    <g
      transform={LOGO_MARK_TRANSFORM}
      stroke="currentColor"
      strokeWidth={LOGO_MARK_STROKE_WIDTH}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {LOGO_MARK_PATHS.map((d) => (
        <path key={d.slice(0, 24)} d={d} />
      ))}
    </g>
  </svg>
);

export default LogoMark;
