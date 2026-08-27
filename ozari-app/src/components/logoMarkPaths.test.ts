import { describe, expect, it } from 'vitest';
import { LOGO_MARK_ASPECT, LOGO_MARK_PATHS, LOGO_MARK_VIEWBOX } from './logoMarkPaths';

describe('LOGO_MARK_ASPECT', () => {
  it('is a real ratio, not NaN', () => {
    // It is parsed out of the viewBox STRING. A viewBox written with commas instead of spaces —
    // both are legal SVG — would make this `NaN`, and `NaN` reaches react-pdf as a zero-width mark:
    // the logo would simply stop appearing on generated documents, with nothing to explain why. The
    // DOM renderer would keep working, so nobody would notice from the app.
    expect(Number.isFinite(LOGO_MARK_ASPECT)).toBe(true);
    expect(LOGO_MARK_ASPECT).toBeGreaterThan(0);
  });

  it('says the mark is TALLER than it is wide', () => {
    // The hexagon-and-arch isotype is a portrait shape. Anything ≥ 1 here means the viewBox was
    // edited into a different mark, and every place that sizes the logo by height would be wrong.
    expect(LOGO_MARK_ASPECT).toBeLessThan(1);
    // The value the PDF used to hardcode as `height = width * 1.264`, kept as a regression guard on
    // the refactor that replaced that literal with this derivation.
    expect(1 / LOGO_MARK_ASPECT).toBeCloseTo(1.264, 3);
  });

  it('is derived from the viewBox it ships beside', () => {
    const [, , width, height] = LOGO_MARK_VIEWBOX.split(' ').map(Number);
    expect(LOGO_MARK_ASPECT).toBe(width! / height!);
  });
});

describe('LOGO_MARK_PATHS', () => {
  it('carries the whole mark', () => {
    // Six subpaths: the hexagon, its two lower edges, and the three strokes of the arch. A path
    // dropped in an edit renders a partial logo rather than an error.
    expect(LOGO_MARK_PATHS).toHaveLength(6);
    expect(LOGO_MARK_PATHS.every((d) => d.startsWith('M '))).toBe(true);
  });
});
