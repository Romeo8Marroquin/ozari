import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';
import { PAGE_ENTER, prefersReducedMotion } from '@utils/motion';
import {
  axisTicks,
  barLayout,
  compactNumber,
  niceMax,
  visibleLabelIndexes,
  type ChartDatum,
} from './chartMath';

interface BarChartProps {
  data: ChartDatum[];
  /** Formats a value for the axis + the accessible summary (money, units, …). */
  formatValue: (value: number) => string;
  /** Accessible description of the whole chart — an SVG is invisible to a screen reader otherwise. */
  ariaLabel: string;
  /** Most labels to draw across the axis before thinning them (see `visibleLabelIndexes`). */
  maxLabels?: number;
  /** Highlights one bar as "the current one" — the trailing-months chart marks this month. */
  highlightLast?: boolean;
  /** The unit the axis counts in (a currency symbol), shown ONCE above it rather than repeated on
   *  every tick. Omit for a bare count. */
  unit?: string;
  className?: string;
}

// A fixed coordinate box the SVG scales from: all geometry below is in these units, so the chart is
// resolution-independent and the math never has to know the rendered size.
const BOX = { width: 320, height: 120 };

/**
 * The axis is drawn in HALVES (0, ½, max), and that is a arithmetic decision rather than a taste
 * one: `niceMax` always returns 1/2/5 × 10ⁿ, and only the HALVES of those are themselves round
 * numbers — quarters of 500 land on 125, which reads as noise on a small chart. Three gridlines also
 * keep a 120px-tall chart legible instead of ruled.
 */
const TICKS = 2;

/** Height + axis gutter, declared once so the labels, the gridlines and the bars cannot drift apart.
 *  The axis is wide enough for `Q 500` (the unit rides on the top tick) plus its right padding —
 *  narrower on a phone, where every pixel it keeps is a pixel the twelve month labels don't have:
 *  at the desktop gutter the last one clipped to `a…` on a 320px screen. */
const CHART_HEIGHT = 'h-32 sm:h-36';
const AXIS_WIDTH = 'w-12 sm:w-14';
const AXIS_PAD = 'pl-12 sm:pl-14';

/**
 * A vertical bar chart, drawn by hand (see `chartMath.ts` for why, and for the trigger to reach for
 * a library instead).
 *
 * **The bars grow from the baseline on the app's own entrance curve**, staggered left-to-right —
 * the same "arrive in a wave" language the panel's pages and the preferences cards use, so a chart
 * reads as part of this app rather than as an embedded widget. Under reduced motion it renders at
 * its final size, like every other surface here.
 *
 * The `<svg>` is `aria-hidden` behind a text summary: a screen reader gets the actual figures, which
 * is strictly more useful than a described rectangle.
 */
const BarChart: React.FC<BarChartProps> = ({
  data,
  formatValue,
  ariaLabel,
  maxLabels = 6,
  highlightLast = false,
  unit,
  className = '',
}) => {
  const root = useRef<SVGSVGElement>(null);
  // Where the bars were drawn last time — the geometry an update animates FROM. `null` until the
  // chart has appeared once, which is exactly the difference between "enter" and "adapt".
  const previous = useRef<{ y: number; height: number }[] | null>(null);
  const max = niceMax(data.map((datum) => datum.value));
  const signature = data.map((datum) => `${datum.label}:${datum.value}`).join('|');
  const ticks = axisTicks(max, TICKS);
  const bars = barLayout(data, (datum) => datum.value, {
    width: BOX.width,
    height: BOX.height,
    max,
  });
  const labels = visibleLabelIndexes(data.length, maxLabels);

  useGSAP(
    () => {
      const els = gsap.utils.toArray<SVGRectElement>('.chart-bar');
      const geometry = bars.map((bar) => ({ y: bar.y, height: bar.height }));
      const before = previous.current;
      previous.current = geometry;
      if (prefersReducedMotion()) return;

      if (!before) {
        // FIRST appearance only: the bars grow out of the BASELINE — the axis is what they measure
        // from, so the motion should say so.
        gsap.from(els, {
          attr: { y: BOX.height, height: 0 },
          duration: PAGE_ENTER.duration,
          ease: PAGE_ENTER.ease,
          // Normalized like every other wave in the app: the whole sweep takes the same time whether
          // there are 5 bars or 12, so more data never means a slower chart.
          /* v8 ignore next -- an empty series renders no `.chart-bar`, so the guard only protects
             the division; the tween has nothing to animate either way */
          stagger: bars.length > 0 ? 0.35 / bars.length : 0,
          overwrite: true,
        });
        return;
      }

      // EVERY LATER CHANGE ADAPTS. React has already written the new geometry, so animating FROM the
      // remembered previous values moves each bar from where it visually was to where it now is —
      // no stagger, no growing out of the floor again. Replaying the entrance on a refresh is what
      // makes a live dashboard feel like it is constantly reloading.
      els.forEach((el, index) => {
        const was = before[index];
        /* v8 ignore next -- the series length is fixed (twelve months); a changed count simply has
           nothing to move from, and the new bar is already at its final size */
        if (!was) return;
        gsap.from(el, {
          attr: was,
          duration: PAGE_ENTER.duration,
          ease: PAGE_ENTER.ease,
          overwrite: true,
        });
      });
    },
    // The dependency is the VALUES, not the array identity: a refetch that changed nothing produces
    // the same signature, so nothing re-runs at all. This is the actual fix for "the graphs animate
    // in on every refresh" — the old `[data]` dep saw a brand-new array every 60 seconds.
    { scope: root, dependencies: [signature] },
  );

  return (
    <div className={className}>
      {/* Headroom: the top tick's label is vertically CENTRED on the chart's top edge, so half of it
          sits above the plot. Without this it collided with the card's subtitle. */}
      <div className="flex items-stretch pt-2">
        {/* The Y AXIS lives OUTSIDE the `<svg>`: the chart stretches (`preserveAspectRatio="none"`)
            so that bars fill any card width, and text inside it would stretch with them. Positioning
            the labels as HTML at the same fractions keeps them crisp at every size. */}
        <div className={`relative ${AXIS_WIDTH} shrink-0 ${CHART_HEIGHT}`} aria-hidden>
          {ticks.map((tick, index) => (
            <span
              key={tick}
              style={{ top: `${(1 - tick / max) * 100}%` }}
              className="absolute right-1 -translate-y-1/2 whitespace-nowrap text-[10px] tabular-nums text-charcoal/45"
            >
              {/* The UNIT rides on the TOP tick rather than floating above the axis. Floating it
                  put a second line of text in the same few pixels as both the top tick and the
                  card's subtitle — three things stacked in one gap, which is what read as cramped.
                  On the tick it is simply part of a number a person would say: "Q 500". */}
              {unit && index === ticks.length - 1 ? `${unit} ` : ''}
              {compactNumber(tick)}
            </span>
          ))}
        </div>

        <svg
          ref={root}
          aria-hidden
          viewBox={`0 0 ${BOX.width} ${BOX.height}`}
          preserveAspectRatio="none"
          // ⚠️ `w-full` is LOAD-BEARING, and `min-w-0` cannot replace it. An `<svg>` with a viewBox
          // is a REPLACED element with an intrinsic ratio, so with a definite height and an `auto`
          // width its min-content contribution is the TRANSFERRED size — here 128px × 320/120 =
          // 341px — which every ancestor then had to be at least that wide to hold. `min-width: 0`
          // is a FLOOR, not a ceiling: it never lowers that contribution, which is why the whole
          // dashboard scrolled sideways on a phone while this element looked correctly constrained.
          // A percentage width makes the contribution resolve against the container instead, so the
          // chart takes the width it is GIVEN — which is the whole point of `preserveAspectRatio`.
          className={`w-full min-w-0 flex-1 ${CHART_HEIGHT}`}
        >
        <defs>
          {/* The brand gradient, top-down, so the bars deepen into blossom exactly like the tile and
              the auth cards do. */}
          <linearGradient id="barChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-cream, #fceda7)" />
            <stop offset="100%" stopColor="var(--color-blossom, #fca7f0)" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => {
          const y = BOX.height - (tick / max) * BOX.height;
          return (
            <line
              key={tick}
              x1={0}
              x2={BOX.width}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeWidth={0.5}
              className="text-charcoal/[0.07]"
            />
          );
        })}
        {bars.map((bar, index) => (
          <rect
            key={bar.item.label}
            className={`chart-bar ${
              highlightLast && index === bars.length - 1 ? 'opacity-100' : 'opacity-70'
            }`}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx={3}
            fill="url(#barChartFill)"
          />
        ))}
        </svg>
      </div>

      {/* Padded by the axis column so each month label stays under its own bar. */}
      <div className={`mt-2 flex w-full ${AXIS_PAD}`} aria-hidden>
        {data.map((datum, index) => (
          <span
            key={datum.label}
            className="min-w-0 flex-1 truncate text-center text-[10px] text-charcoal/45"
          >
            {labels.has(index) ? datum.label : ''}
          </span>
        ))}
      </div>

      {/* The chart's real accessible content: the numbers, not a description of rectangles. */}
      <p className="sr-only">
        {ariaLabel}
        {data.map((datum) => ` ${datum.label}: ${formatValue(datum.value)}.`).join('')}
      </p>
    </div>
  );
};

export default BarChart;
