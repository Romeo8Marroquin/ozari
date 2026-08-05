import { describe, expect, it } from 'vitest';
import {
  arcLength,
  arcPath,
  axisTicks,
  barLayout,
  compactNumber,
  donutSegments,
  niceMax,
  polarPoint,
  round3,
  visibleLabelIndexes,
} from './chartMath';

/** The identity accessor — these suites test the geometry, not the pairing. */
const value = (v: number): number => v;

describe('niceMax', () => {
  it('rounds UP to a 1/2/5 step so the axis reads like a number a person would say', () => {
    expect(niceMax([487])).toBe(500);
    expect(niceMax([120, 90])).toBe(200);
    expect(niceMax([1, 0.4])).toBe(1);
    expect(niceMax([6000])).toBe(10000);
    expect(niceMax([1500])).toBe(2000);
  });

  it('never returns the raw peak, so the tallest bar never touches the ceiling', () => {
    expect(niceMax([1000])).toBeGreaterThanOrEqual(1000);
    expect(niceMax([999])).toBe(1000);
  });

  it('is 1 for an all-zero or negative series — a domain of 0 would divide to NaN', () => {
    expect(niceMax([])).toBe(1);
    expect(niceMax([0, 0])).toBe(1);
    expect(niceMax([-5])).toBe(1);
  });
});

describe('axisTicks', () => {
  it('spans 0..max inclusive with exactly count+1 labels', () => {
    expect(axisTicks(1000, 4)).toEqual([0, 250, 500, 750, 1000]);
  });

  it('lands exactly on max rather than drifting by accumulation', () => {
    const ticks = axisTicks(100, 3);
    expect(ticks[ticks.length - 1]).toBe(100);
  });
});

describe('barLayout', () => {
  const options = { width: 300, height: 100, max: 100 };

  it('scales height by the value and anchors bars to the baseline', () => {
    const [full, half] = barLayout([100, 50], value, options);
    expect(full).toMatchObject({ height: 100, y: 0 });
    expect(half).toMatchObject({ height: 50, y: 50 });
  });

  it('carries the ITEM with its geometry, so a caller never re-looks-it-up by index', () => {
    const data = [{ label: 'ene', v: 10 }];
    const [bar] = barLayout(data, (datum) => datum.v, options);
    expect(bar?.item).toBe(data[0]);
  });

  it('spaces bars evenly and centres each in its slot', () => {
    const bars = barLayout([1, 1, 1], value, { ...options, gapRatio: 0.5 });
    expect(bars.map((bar) => bar.width)).toEqual([50, 50, 50]);
    // Slot 100 wide, bar 50 wide ⇒ 25 of padding each side.
    expect(bars.map((bar) => bar.x)).toEqual([25, 125, 225]);
  });

  it('gives a zero value a hairline, so "no business" is a visible bar and not a gap', () => {
    const [zero] = barLayout([0], value, { ...options, minHeight: 2 });
    expect(zero?.height).toBe(2);
    expect(zero?.y).toBe(98);
  });

  it('clamps a negative value instead of drawing upside-down out of the box', () => {
    const [negative] = barLayout([-40], value, options);
    expect(negative?.height).toBe(2);
  });

  it('is empty for no data', () => {
    expect(barLayout([], value, options)).toEqual([]);
  });
});

describe('polarPoint', () => {
  it('puts 0° at 12 o’clock and runs clockwise, like a dial', () => {
    expect(polarPoint(50, 50, 0)).toEqual({ x: 50, y: 0 });
    expect(polarPoint(50, 50, 90)).toEqual({ x: 100, y: 50 });
    expect(polarPoint(50, 50, 180)).toEqual({ x: 50, y: 100 });
  });
});

describe('arcPath', () => {
  it('flags the large-arc sweep past a half turn', () => {
    expect(arcPath(50, 40, 0, 90)).toContain('A 40 40 0 0 1');
    expect(arcPath(50, 40, 0, 270)).toContain('A 40 40 0 1 1');
  });

  it('splits a FULL circle into two arcs — a single 360° arc renders nothing', () => {
    const path = arcPath(50, 40, 0, 360);
    // Two `M`oves ⇒ two sub-arcs, which is what keeps a lone slice visible at all.
    expect(path.match(/M /g)).toHaveLength(2);
  });
});

describe('arcLength', () => {
  it('is the circumference share, so the draw-on needs no DOM measurement', () => {
    expect(arcLength(10, 360)).toBeCloseTo(2 * Math.PI * 10, 2);
    expect(arcLength(10, 90)).toBeCloseTo((2 * Math.PI * 10) / 4, 2);
    expect(arcLength(10, 0)).toBe(0);
  });
});

describe('donutSegments', () => {
  it('turns values into proportional ring segments', () => {
    const segments = donutSegments([3, 1], value, { radius: 40, center: 50 });
    expect(segments).toHaveLength(2);
    expect(segments[0]?.ratio).toBe(0.75);
    expect(segments[1]?.ratio).toBe(0.25);
    expect(segments[0]?.path.startsWith('M ')).toBe(true);
    // Each segment carries its own drawn length, so the animation never asks the DOM to measure it.
    expect(segments[0]?.length).toBeGreaterThan(segments[1]?.length ?? 0);
  });

  it('carries the ITEM through, so the caller styles from the slice it passed in', () => {
    const slices = [{ label: 'Pendiente', v: 3 }];
    const [segment] = donutSegments(slices, (slice) => slice.v, { radius: 40, center: 50 });
    expect(segment?.item).toBe(slices[0]);
  });

  it('keeps the original index so the caller can map back to its colours', () => {
    const segments = donutSegments([0, 5, 0, 5], value, { radius: 40, center: 50 });
    expect(segments.map((segment) => segment.index)).toEqual([1, 3]);
  });

  it('drops zero slices rather than emitting invisible paths', () => {
    expect(donutSegments([0, 0, 4], value, { radius: 40, center: 50 })).toHaveLength(1);
  });

  it('is empty when there is nothing to show', () => {
    expect(donutSegments([], value, { radius: 40, center: 50 })).toEqual([]);
    expect(donutSegments([0, 0], value, { radius: 40, center: 50 })).toEqual([]);
  });

  it('drops the separator gap for a lone slice — it would only clip the ring', () => {
    const [single] = donutSegments([7], value, { radius: 40, center: 50, gapDegrees: 20 });
    // A gapless single slice is the full circle, which `arcPath` emits as two sub-arcs.
    expect(single?.path.match(/M /g)).toHaveLength(2);
  });
});

describe('visibleLabelIndexes', () => {
  it('keeps every label when they all fit', () => {
    expect([...visibleLabelIndexes(4, 6)]).toEqual([0, 1, 2, 3]);
  });

  it('thins from the END, so the most recent bar is always labelled', () => {
    const kept = visibleLabelIndexes(12, 6);
    expect(kept.has(11)).toBe(true);
    expect(kept.size).toBeLessThanOrEqual(6);
  });

  it('keeps a regular stride rather than dropping arbitrary labels', () => {
    expect([...visibleLabelIndexes(12, 6)].sort((a, b) => a - b)).toEqual([1, 3, 5, 7, 9, 11]);
  });

  it('degenerate maxLabels keeps everything instead of hiding the axis entirely', () => {
    expect([...visibleLabelIndexes(3, 0)]).toEqual([0, 1, 2]);
  });
});

describe('compactNumber', () => {
  it('reads an axis for MAGNITUDE, not for cents', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(850)).toBe('850');
    expect(compactNumber(12_400)).toBe('12k');
    expect(compactNumber(1_200_000)).toBe('1.2M');
    expect(compactNumber(24_000_000)).toBe('24M');
  });

  it('keeps one decimal only while it still distinguishes neighbouring ticks', () => {
    expect(compactNumber(1_200)).toBe('1.2k'); // below 10k the decimal helps…
    expect(compactNumber(124_300)).toBe('124k'); // …above it, it is noise
  });

  it('handles negatives without losing the unit', () => {
    expect(compactNumber(-2_500)).toBe('-2.5k');
  });
});

describe('round3', () => {
  it('trims path coordinates below a device pixel', () => {
    expect(round3(1.23456)).toBe(1.235);
  });
});
