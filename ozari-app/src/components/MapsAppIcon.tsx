import appleMaps from '@assets/maps/apple-maps.png';
import googleMaps from '@assets/maps/google-maps.png';
import waze from '@assets/maps/waze.png';
import type { MapsApp } from '@utils/mapLinks';

/**
 * The three maps apps' marks.
 *
 * These are REAL logo assets, not hand-drawn SVG. The first version recreated each mark by hand to
 * avoid the extra files — and hand-tracing a brand logo lands in an uncanny valley where it is
 * recognisable enough to be identified and wrong enough to look broken. A brand mark's whole job is
 * instant recognition, so an approximation is worse than useless.
 *
 * They are imported (not referenced from `public/`) so Vite fingerprints and inlines them, and they
 * are served from our own origin — which the CSP's `img-src 'self'` already allows, unlike a remote
 * CDN logo, which it would block outright.
 *
 * @see `src/assets/maps/README.md` for the file contract (names, size, format).
 */
const SOURCES: Record<MapsApp, string> = {
  google: googleMaps,
  waze,
  apple: appleMaps,
};

/** Decorative: the button or row beside it always carries the app's NAME as text. */
const MapsAppIcon: React.FC<{ app: MapsApp; className?: string }> = ({ app, className = '' }) => (
  <img src={SOURCES[app]} alt="" aria-hidden className={`object-contain ${className}`} />
);

export default MapsAppIcon;
