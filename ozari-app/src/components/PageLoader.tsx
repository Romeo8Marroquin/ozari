import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { prefersReducedMotion } from '@utils/motion';
import LogoMark from './LogoMark';

/** The outline the beam travels: a rounded SQUARE, concentric with the brand tile inside it — a
 *  100×100 viewBox box inset 1.5 for the stroke, with 33-unit corners. */
const TILE_OUTLINE =
  'M 34.5 1.5 H 65.5 A 33 33 0 0 1 98.5 34.5 V 65.5 A 33 33 0 0 1 65.5 98.5 H 34.5 A 33 33 0 0 1 1.5 65.5 V 34.5 A 33 33 0 0 1 34.5 1.5 Z';

/**
 * That outline's perimeter in viewBox units — four 31-unit straight edges plus four corner quadrants,
 * which together are exactly one circle of r=33. It is a constant because the path lives in viewBox
 * units: the rendered size changes with the breakpoint, this does not.
 *
 * The dash pattern is derived from it rather than from `pathLength="100"`, which does NOT reliably
 * rescale `stroke-dasharray` — with a literal `26 74` the pattern repeated 3.3× around the 331-unit
 * path, so the "single beam" was three, and since 331 is not a multiple of 100 the loop jumped at the
 * seam on every lap. Deriving the numbers costs nothing and cannot silently mean something else.
 *
 * `dash + gap === OUTLINE_LENGTH` is what makes both guarantees hold: exactly ONE beam on the path,
 * and a period equal to the perimeter, so animating the offset by one full length closes seamlessly.
 *
 * For the same reason the strokes here are plain user units and NOT `vector-effect:
 * non-scaling-stroke`: that keyword moves stroke-dasharray into post-transform space too, so the
 * pattern gets measured against the RENDERED length (331 units × the box's scale) and repeats once
 * per unit of scale — two beams at `md`, and a different count at every breakpoint. Letting the
 * outline's weight scale with the object is also simply what should happen when the object grows.
 */
const OUTLINE_LENGTH = 4 * 31 + 2 * Math.PI * 33;
/** The share of the perimeter the beam covers. */
const BEAM_SPAN = 0.26;
const BEAM_DASH = `${OUTLINE_LENGTH * BEAM_SPAN} ${OUTLINE_LENGTH * (1 - BEAM_SPAN)}`;

/**
 * The full-screen route loader — TanStack Router's `defaultPendingComponent`, shown while a route's
 * code-split chunk / loader data is still in flight (mostly on slow networks).
 *
 * **It is built from the app's own brand object, not from generic loader parts.** Two rules it now
 * obeys, both learned the hard way:
 *
 * 1. **The canvas stays neutral; the COLOUR lives in the object.** A full-bleed cream→blossom wash
 *    (the original) read as a splash screen from another product and made every hand-off — to the
 *    near-white panel, to a white auth card — a visible colour pop. So the background is the shared
 *    `.app-canvas` and the brand gradient sits where it sits everywhere else in the app: inside a
 *    contained shape, with a soft halo behind it.
 * 2. **The shape is a rounded SQUARE, because that is the only brand container we have.** A circle
 *    holding the logo (the first attempt) exists nowhere else in the product — the sidebar's
 *    `BrandMark`, the thing a user actually associates with us, is a `rounded-xl` cream→blossom tile
 *    with the charcoal {@link LogoMark} inside. This is that tile at hero scale, deliberately mirrored
 *    rather than imported: `BrandMark` is fixed at `size-11` for the chrome, and overriding a Tailwind
 *    size utility from a `className` prop is decided by stylesheet order, not by the class list.
 *
 * The loading indicator is therefore the tile's **own outline coming alive**: a hairline track with a
 * gradient beam running its perimeter. It is a spinner that could only belong to this app.
 *
 * **Motion.** The loader appears instantly (the router's own `pendingMs`/`pendingMinMs` defaults keep
 * it off screen on fast loads), so it plays its own entrance and nothing pops in: canvas fades, halo
 * and tile rise together, the mark lands, the outline scales in. Then two ambient loops — the beam
 * travels linearly (an eased spinner reads as the app hesitating rather than working) and the tile
 * breathes against a counter-phased halo. Under reduced motion it simply renders, static.
 *
 * **The exit is the router's view transition, shaped by us** — see `.page-loader-mark` in
 * `index.css`. React unmounts a pending component the frame the route commits, so it can never own a
 * GSAP exit like a panel page does; naming the mark gives it its own dissolve curve while the root
 * cross-fade handles a background that is now identical on both sides.
 */
export default function PageLoader() {
  const { t } = useTranslation();
  const section = useRef<HTMLElement>(null);
  const halo = useRef<HTMLSpanElement>(null);
  const outline = useRef<SVGSVGElement>(null);
  const beam = useRef<SVGPathElement>(null);
  const tile = useRef<HTMLSpanElement>(null);
  const logo = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;

      gsap
        .timeline()
        .from(section.current, { autoAlpha: 0, duration: 0.3, ease: 'power2.out' })
        .from(tile.current, { scale: 0.86, y: 10, autoAlpha: 0, duration: 0.6, ease: 'power3.out' }, '-=0.14')
        // The halo swells with the tile, not after it — it is the tile's own light, not a second object.
        .from(halo.current, { scale: 0.7, autoAlpha: 0, duration: 0.75, ease: 'power2.out' }, '<')
        .from(logo.current, { autoAlpha: 0, duration: 0.4, ease: 'power2.out' }, '-=0.42')
        .from(outline.current, { scale: 0.93, autoAlpha: 0, duration: 0.5, ease: 'power3.out' }, '-=0.44');

      // Ambient, all kept OUT of the timeline: an infinite tween inside one would strand anything
      // sequenced after it.
      //
      // One lap is exactly one perimeter (see OUTLINE_LENGTH) — the pattern's period, so the loop
      // closes on itself with no seam to hide.
      gsap.to(beam.current, { strokeDashoffset: -OUTLINE_LENGTH, duration: 1.7, ease: 'none', repeat: -1 });
      // A slow breath, the quiet equivalent of the error screen's drifting blobs. Counter-phased: the
      // halo dims as the tile swells, so the pair reads as one object breathing rather than two
      // things pulsing in lockstep. Both start after the entrance has settled the same properties.
      gsap.to(tile.current, { scale: 1.02, duration: 2.6, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 1.1 });
      gsap.to(halo.current, { opacity: 0.3, duration: 2.6, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 1.1 });
    },
    { scope: section },
  );

  return (
    <section ref={section} className="app-canvas fixed inset-0 flex items-center justify-center">
      {/* The outline ORBITS the tile — the gap is load-bearing. Tight against it, the beam reads as a
          border on the icon (an app-store download badge); at a real distance it reads as something
          circling while we wait. The two radii are kept concentric (outer = tile radius + gap) so the
          curves stay parallel: `TILE_OUTLINE`'s 33 units ≈ 33% of the box at both breakpoints. */}
      <div className="page-loader-mark relative grid size-40 place-items-center md:size-48">
        {/* The tile's own light — the brand gradient spilling out, blurred. It is deliberately WIDER
            than the outline: contained inside it, the colour reads as a fill and the screen still
            looks white; spilling past it, the warmth is what you notice before the shape. This is how
            the loader carries the brand without tinting the viewport. */}
        <span
          ref={halo}
          aria-hidden
          className="absolute size-[92%] rounded-[38%] bg-gradient-to-br from-cream to-blossom opacity-70 blur-2xl"
        />

        {/* The indicator: the tile's outline, concentric with it. A hairline track plus one gradient
            beam travelling the perimeter — the accent moves, so it needs no weight to be seen. */}
        <svg
          ref={outline}
          aria-hidden
          viewBox="0 0 100 100"
          fill="none"
          className="absolute inset-0 size-full text-charcoal/[0.07]"
        >
          <defs>
            {/* Runs top-left → bottom-right, the same direction as the tile's own gradient, so the
                beam brightens into magenta exactly where the tile deepens into blossom. */}
            <linearGradient id="pageLoaderBeam" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--color-blossom, #fca7f0)" />
              <stop offset="100%" stopColor="var(--color-magenta, #ff01ed)" />
            </linearGradient>
          </defs>
          <path d={TILE_OUTLINE} stroke="currentColor" strokeWidth={0.85} />
          <path
            ref={beam}
            d={TILE_OUTLINE}
            stroke="url(#pageLoaderBeam)"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeDasharray={BEAM_DASH}
          />
        </svg>

        {/* The brand tile — `BrandMark` at hero scale (see the note above on why it is mirrored, not
            imported). Same gradient, same charcoal mark, so this reads as the thing in the sidebar
            rather than as a lookalike. The ONE deliberate difference is the mark's share of the tile:
            `BrandMark` fills 88% because at 44px the tile is barely more than a backing plate, but the
            same ratio at 128px reads cramped — padding is optical, so a hero needs proportionally more
            of it. */}
        <span
          ref={tile}
          className="relative grid size-26 place-items-center rounded-[26px] bg-gradient-to-br from-cream to-blossom text-charcoal shadow-[0_14px_34px_-18px_rgba(38,38,38,0.5)] md:size-32 md:rounded-[32px]"
        >
          <span
            ref={logo}
            role="img"
            aria-label={t('components.pageLoader.logo')}
            className="block size-[72%]"
          >
            <LogoMark className="size-full" />
          </span>
        </span>
      </div>

      {/* Announced, never drawn: on a fast route this whole screen lives for a few hundred ms, and a
          line of text that flashes in and out is noise. Screen readers still get the state. */}
      <p role="status" className="sr-only">
        {t('components.pageLoader.loading')}
      </p>
    </section>
  );
}
