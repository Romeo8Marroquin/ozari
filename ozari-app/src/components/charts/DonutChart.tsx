import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';
import { PAGE_ENTER, prefersReducedMotion } from '@utils/motion';
import { donutSegments } from './chartMath';

export interface DonutSlice {
  label: string;
  value: number;
  /** A Tailwind text-colour class — the ring inherits it via `currentColor`, so the palette stays
   *  in the design layer and this component never maps tokens to hex. */
  colorClass: string;
}

interface DonutChartProps {
  slices: DonutSlice[];
  /** Big number in the middle — the total the ring is a breakdown OF. */
  centerValue: string;
  centerLabel: string;
  ariaLabel: string;
  className?: string;
}

const BOX = 120;
const CENTER = BOX / 2;
const RADIUS = 48;
const THICKNESS = 12;

/**
 * A donut breakdown, drawn as stroked ARC PATHS (never a dash-offset circle — that pattern is
 * measured against the RENDERED length and silently repeats when the element scales, which is
 * exactly the bug the page loader's beam hit).
 *
 * The ring draws itself on: each segment sweeps out clockwise from 12 o'clock via `strokeDasharray`
 * on its OWN path, where the dash length is that path's own length, so scaling is irrelevant. Under
 * reduced motion it simply appears.
 */
const DonutChart: React.FC<DonutChartProps> = ({
  slices,
  centerValue,
  centerLabel,
  ariaLabel,
  className = '',
}) => {
  const root = useRef<SVGSVGElement>(null);
  // Has the ring ever drawn itself on? That is the whole difference between "enter" and "adapt".
  const hasDrawn = useRef(false);
  const segments = donutSegments(slices, (slice) => slice.value, {
    radius: RADIUS,
    center: CENTER,
  });
  const signature = slices.map((slice) => `${slice.label}:${slice.value}`).join('|');

  useGSAP(
    () => {
      const first = !hasDrawn.current;
      hasDrawn.current = true;

      segments.forEach((segment, index) => {
        // The dash length comes from the SEGMENT's own computed geometry, never from
        // `getTotalLength()` — see `DonutSegment.length`.
        const { length } = segment;
        const target = `.donut-segment-${segment.index}`;
        const full = { strokeDasharray: `${length} ${length}` };

        if (!first || prefersReducedMotion()) {
          // ADAPT, don't re-enter. Setting the dash to the NEW arc's own length is also required for
          // correctness, not just polish: the entrance leaves an inline dasharray behind, and a
          // stale one would clip the redrawn arc to the previous slice's size.
          gsap.set(target, full);
          return;
        }
        gsap.fromTo(target, { strokeDasharray: `0 ${length}` }, {
          ...full,
          duration: PAGE_ENTER.duration,
          ease: PAGE_ENTER.ease,
          // Segments arrive in ring order, sharing one normalized budget — the same wave rule the
          // bars and the panel's pages use.
          delay: (0.35 / segments.length) * index,
          overwrite: true,
        });
      });
    },
    // The VALUES, not the array identity: an unchanged refetch re-runs nothing (see `BarChart`).
    { scope: root, dependencies: [signature] },
  );

  return (
    <div className={`flex items-center gap-5 ${className}`}>
      <div className="relative shrink-0">
        <svg
          ref={root}
          aria-hidden
          viewBox={`0 0 ${BOX} ${BOX}`}
          className="size-28 sm:size-32"
          fill="none"
        >
          {/* The track: what the ring would look like full. Keeps an almost-empty donut from
              reading as a rendering failure. */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            stroke="currentColor"
            strokeWidth={THICKNESS}
            className="text-charcoal/[0.06]"
          />
          {segments.map((segment) => (
            <path
              key={segment.item.label}
              className={`donut-segment donut-segment-${segment.index} ${segment.item.colorClass || 'text-charcoal/30'}`}
              d={segment.path}
              stroke="currentColor"
              strokeWidth={THICKNESS}
              strokeLinecap="round"
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-xl font-bold text-charcoal sm:text-2xl">{centerValue}</p>
            <p className="text-[10px] uppercase tracking-wide text-charcoal/45">{centerLabel}</p>
          </div>
        </div>
      </div>

      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        {slices.map((slice) => (
          <li key={slice.label} className="flex min-w-0 items-center gap-2 text-xs">
            <span
              aria-hidden
              className={`size-2 shrink-0 rounded-full bg-current ${slice.colorClass}`}
            />
            <span className="min-w-0 flex-1 truncate text-charcoal/70">{slice.label}</span>
            {/* A column of counts is read DOWNWARD, so the digits have to line up: `tabular-nums`
                fixes the glyph width (proportional digits made "2" and "1" sit differently) and the
                right-aligned min-width keeps the column steady when a count reaches two or three
                figures instead of shifting every row. */}
            <span className="min-w-[2ch] shrink-0 text-right font-semibold tabular-nums text-charcoal">
              {slice.value}
            </span>
          </li>
        ))}
      </ul>

      <p className="sr-only">
        {ariaLabel}
        {slices.map((slice) => ` ${slice.label}: ${slice.value}.`).join('')}
      </p>
    </div>
  );
};

export default DonutChart;
