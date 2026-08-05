/**
 * The chart PRIMITIVES' math — every decision a chart makes, in pure functions.
 *
 * The components in this folder draw SVG and animate it with the app's GSAP vocabulary; everything
 * that could be *wrong* rather than merely ugly lives here, where it is tested. Same split as
 * `leafletMap.ts` (untestable rendering excluded, decisions in tested modules) and `pageMotion.ts`'s
 * `revealInScroller`.
 *
 * **Why hand-rolled rather than a charting library** (owner decision, 2026-08-04): the app's motion
 * doctrine is that GSAP owns choreography and nothing else animates the same property, and every
 * batteries-included chart library ships its own animation engine plus visual defaults that would
 * have to be fought back to our design language. What this dashboard needs — bars and an arc — is
 * `value / max × height` plus one path helper.
 *
 * **The documented trigger to reach for a library** (`visx`, MIT — low-level D3 primitives, no
 * imposed visuals): the first chart that needs any ONE of smart axis-tick selection over dense time
 * series, zoom/brush, hit-testing across overlapping series, or a log scale. At that point add it
 * for THAT chart only — the props contract in this folder is ours, so nothing else has to move.
 */

/** A single plotted value with the label the axis shows for it. */
export interface ChartDatum {
  label: string;
  value: number;
  /** Optional secondary figure carried through for tooltips/legends (e.g. order count). */
  meta?: number;
}

/** A bar's geometry inside the chart's coordinate box, in the SAME units as the viewBox. */
export interface BarGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The value a chart's axis should top out at.
 *
 * Never the raw maximum: a bar touching the ceiling reads as "full" rather than "biggest", and the
 * gridline above it has nowhere to go. Rounds UP to a friendly 1/2/5×10ⁿ step so the axis labels are
 * numbers a person would say out loud (500, not 487).
 *
 * An all-zero series returns 1 rather than 0 — dividing by the domain must never produce `NaN`, and
 * a flat empty chart should render a baseline, not nothing.
 */
export function niceMax(values: readonly number[]): number {
  const peak = Math.max(0, ...values);
  if (peak <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const normalized = peak / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Evenly spaced axis values from 0 to `max` inclusive — `count` gaps means `count + 1` labels.
 * Kept exact by multiplying rather than accumulating, so the top tick is precisely `max`.
 */
export function axisTicks(max: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, index) => (max / count) * index);
}

/**
 * Lays out a vertical bar series inside a `width × height` box.
 *
 * `gapRatio` is the share of each slot given to whitespace, so bars stay proportionally spaced at
 * any count — 12 months and 5 products both look deliberate without per-chart tuning. A zero value
 * still gets a hairline (`minHeight`) so "no business that month" is visibly a bar at zero rather
 * than a gap the eye reads as missing data.
 */
export function barLayout<T>(
  items: readonly T[],
  valueOf: (item: T) => number,
  options: {
    width: number;
    height: number;
    max: number;
    gapRatio?: number;
    minHeight?: number;
  },
): (BarGeometry & { item: T })[] {
  const { width, height, max, gapRatio = 0.32, minHeight = 2 } = options;
  if (items.length === 0) {
    return [];
  }
  const slot = width / items.length;
  const barWidth = slot * (1 - gapRatio);
  // The ITEM travels with its geometry: a caller that re-looked-it-up by index would need a
  // defensive `?.` on every render for a lookup that cannot fail.
  return items.map((item, index) => {
    const value = valueOf(item);
    // Clamp at zero: a negative figure is not meaningful on these charts and must never draw
    // upside-down out of the box.
    const ratio = Math.max(0, value) / max;
    const barHeight = Math.max(minHeight, ratio * height);
    return {
      item,
      x: index * slot + (slot - barWidth) / 2,
      y: height - barHeight,
      width: barWidth,
      height: barHeight,
    };
  });
}

/** One ring segment: where it starts and how much of the circle it covers. */
export interface DonutSegment {
  /** The datum's index in the input, so the caller can map back to colours/labels. */
  index: number;
  value: number;
  /** Share of the whole, 0..1. */
  ratio: number;
  path: string;
  /**
   * The drawn arc's length in viewBox units.
   *
   * Computed rather than measured with `getTotalLength()`: we already know the radius and the sweep,
   * so asking the DOM to re-derive it is a round trip through an API that only exists in a real
   * browser — the draw-on animation would then be untestable, and would throw outright wherever SVG
   * geometry is unimplemented.
   */
  length: number;
}

/** The length of an arc of `sweepDegrees` on a circle of `radius`. */
export function arcLength(radius: number, sweepDegrees: number): number {
  return round3(2 * Math.PI * radius * (sweepDegrees / 360));
}

/**
 * Builds the ring segments of a donut.
 *
 * Everything is drawn as an ARC PATH rather than a dash-offset circle, because a dashed circle's
 * pattern is measured against the rendered length and silently repeats when the element is scaled —
 * the exact bug the page loader's beam hit. A path is scale-invariant.
 *
 * A single non-zero slice would be a full circle, which SVG cannot express as one arc (start and end
 * coincide); it is drawn as two half-arcs instead, which renders identically.
 */
export function donutSegments<T>(
  items: readonly T[],
  valueOf: (item: T) => number,
  options: { radius: number; center: number; gapDegrees?: number },
): (DonutSegment & { item: T })[] {
  const { radius, center, gapDegrees = 2 } = options;
  const total = items.reduce((sum, item) => sum + Math.max(0, valueOf(item)), 0);
  if (total <= 0) {
    return [];
  }
  const positive = items.filter((item) => valueOf(item) > 0).length;
  // With one slice there is no neighbour to separate from, so the gap would only clip the ring.
  const gap = positive > 1 ? gapDegrees : 0;
  let cursor = 0;
  return items.flatMap((item, index) => {
    const value = valueOf(item);
    if (value <= 0) {
      return [];
    }
    const ratio = value / total;
    const start = cursor;
    const sweep = ratio * 360;
    cursor += sweep;
    const drawnFrom = start + gap / 2;
    const drawnTo = start + sweep - gap / 2;
    return [
      {
        item,
        index,
        value,
        ratio,
        path: arcPath(center, radius, drawnFrom, drawnTo),
        length: arcLength(radius, drawnTo - drawnFrom),
      },
    ];
  });
}

/** A point on a circle, with 0° at 12 o'clock and angles running clockwise — how a person reads a
 *  dial, and how every slice below is measured. */
export function polarPoint(
  center: number,
  radius: number,
  degrees: number,
): { x: number; y: number } {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: round3(center + radius * Math.cos(radians)),
    y: round3(center + radius * Math.sin(radians)),
  };
}

/**
 * An open arc from `startDeg` to `endDeg`, stroked (never filled) — so the ring's thickness is the
 * stroke width and one number controls it.
 *
 * A sweep of 360° or more is emitted as TWO half arcs: SVG's elliptical-arc command draws nothing
 * when its start and end points coincide, so a lone full-circle slice would silently vanish.
 */
export function arcPath(
  center: number,
  radius: number,
  startDeg: number,
  endDeg: number,
): string {
  const sweep = endDeg - startDeg;
  if (sweep >= 360) {
    const half = startDeg + 180;
    return `${arcPath(center, radius, startDeg, half)} ${arcPath(center, radius, half, startDeg + 359.999)}`;
  }
  const start = polarPoint(center, radius, startDeg);
  const end = polarPoint(center, radius, endDeg);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

/**
 * A short axis label for `value` — `0`, `850`, `12.4k`, `1.2M`.
 *
 * An axis is read for MAGNITUDE, not for cents: "Q 12,400.00" down the side of a 120px-tall chart is
 * four times the width of the chart's own gridline spacing and tells the reader nothing the exact
 * figure in the cards above doesn't already say. One significant decimal is kept below 10× a unit
 * (`1.2k`, but `12k`), which is where the difference is actually legible.
 */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const unit = abs >= 1_000_000 ? 1_000_000 : abs >= 1_000 ? 1_000 : 1;
  const suffix = unit === 1_000_000 ? 'M' : unit === 1_000 ? 'k' : '';
  const scaled = value / unit;
  // One decimal only while it still distinguishes neighbouring ticks; `12.4k` helps, `124.3k` is noise.
  const decimals = unit > 1 && Math.abs(scaled) < 10 ? 1 : 0;
  return `${Number(scaled.toFixed(decimals))}${suffix}`;
}

/** Three decimals is ~0.001 viewBox units — far below a device pixel, and it keeps path strings
 *  short enough to read while debugging. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Which bar labels to draw when they would otherwise collide.
 *
 * Twelve month labels do not fit across a phone, and the usual fixes are both bad: rotating them
 * makes a chart you have to tilt your head to read, and dropping the axis makes the chart lie about
 * its own scale. Instead every `nth` label is kept — always including the LAST one, because on a
 * trailing-months chart the most recent bar is the one being looked at.
 */
export function visibleLabelIndexes(count: number, maxLabels: number): Set<number> {
  if (count <= maxLabels || maxLabels <= 0) {
    return new Set(Array.from({ length: count }, (_, index) => index));
  }
  const step = Math.ceil(count / maxLabels);
  const kept = new Set<number>();
  for (let index = count - 1; index >= 0; index -= step) {
    kept.add(index);
  }
  return kept;
}
