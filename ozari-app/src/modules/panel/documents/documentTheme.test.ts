import { describe, expect, it } from 'vitest';
import {
  COL_DAYS,
  COL_PRICE,
  COL_QUANTITY,
  COL_TOTAL,
  CONTENT_WIDTH,
  cornerWedgePath,
  descriptionWidth,
  FOOTER_CLEARANCE,
  footerPadding,
  GROUP_HEAD_AHEAD,
  HAIRLINE,
  opticalCenterPad,
  roundedTopPath,
  ROW_ALT,
  ROW_BASE,
  ROW_MIN_HEIGHT,
  TABLE_HEAD,
  TABLE_HEAD_HEIGHT,
  ROW_PADDING,
  TOTALS_INNER_WIDTH,
  TOTALS_PADDING,
  TOTALS_WIDTH,
} from './documentTheme';

describe('descriptionWidth', () => {
  it('gives the description whatever the numeric columns and the padding leave', () => {
    // The header and the body rows are SEPARATE elements — `fixed` repeats the header on every
    // page, so it cannot share a flex context with the rows it labels. Two independent flex layouts
    // drift by a point or two and the columns stop lining up, which is why every width here is
    // absolute and why this sum has to come out exactly.
    const fixedColumns = COL_QUANTITY + COL_PRICE + COL_TOTAL + ROW_PADDING * 2;
    expect(descriptionWidth(false) + fixedColumns).toBe(CONTENT_WIDTH);
    expect(descriptionWidth(true) + fixedColumns + COL_DAYS).toBe(CONTENT_WIDTH);
  });

  it('hands the days column back to the description on a table that has none', () => {
    // A sale has no billed window, so the column is dropped rather than filled with a column of 1s
    // explaining nothing — and the descriptions get the room.
    expect(descriptionWidth(false) - descriptionWidth(true)).toBe(COL_DAYS);
  });
});

describe('opticalCenterPad', () => {
  it('lifts a centred run by about a tenth of its font size', () => {
    // react-pdf centres the line BOX, whose lower half is descender room that labels like "TOTAL"
    // and "Saldo pendiente" do not use, so the visible letters land below the middle. Padding
    // shifts centred content by HALF of what is added, so ~0.0875 of the font size of correction
    // needs ~0.175 of bottom padding. Measured against a render, not derived — see the source.
    expect(opticalCenterPad(12)).toBe(2);
    expect(opticalCenterPad(8)).toBe(1.5);
  });

  it('rounds to a HALF point rather than to a whole one', () => {
    // A whole-point correction is up to half a point off at these sizes, which is the same order as
    // the error being corrected. Half points are exact enough and still stable across renders.
    expect(opticalCenterPad(9.5)).toBe(1.5);
    expect(opticalCenterPad(20)).toBe(3.5);
  });
});

describe('footerPadding', () => {
  it('always leaves the declared clearance above the standing notes', () => {
    // The whole point of moving this gap into the page's padding: it has to hold on EVERY page,
    // including one whose content fills the column exactly. A flat number could only promise it for
    // the note count it happened to be tuned against.
    for (const noteCount of [0, 1, 2]) {
      expect(footerPadding(noteCount)).toBeGreaterThanOrEqual(FOOTER_CLEARANCE);
    }
  });

  it('reserves MORE for a quote than for a receipt, since a quote prints one more note', () => {
    // This is what pays for the clearance. The padding used to be fixed at the two-line worst case,
    // so a receipt reserved room for a line it never prints — and adding the clearance on top of
    // that pushed an ordinary one-page order onto a second sheet.
    expect(footerPadding(2)).toBeGreaterThan(footerPadding(1));
    expect(footerPadding(1)).toBeGreaterThan(footerPadding(0));
  });

  it('still clears the page number when a document prints no notes at all', () => {
    // A letterhead with no terms on a receipt leaves the notes block empty, and the padding must not
    // then collapse onto the page number — the one piece of furniture that is never conditional.
    expect(footerPadding(0)).toBeGreaterThan(28);
  });
});

describe('GROUP_HEAD_AHEAD', () => {
  it('reserves the column labels plus a full row', () => {
    // A title, its column labels and its first row are one thought. Reserving less would let a
    // heading end a page announcing a table that starts on the next one — which is also what left a
    // clipped band of the `fixed` header behind it.
    expect(GROUP_HEAD_AHEAD).toBe(TABLE_HEAD_HEIGHT + ROW_MIN_HEIGHT);
  });
});

describe('roundedTopPath', () => {
  it('rounds the top corners and leaves the bottom square', () => {
    // The header's bottom edge is the MIDDLE of the table, and the middle of a shape has no
    // corners. Rounding all four cut two page-white wedges out of the table's sides where the band
    // curved away from the square row beneath it.
    const d = roundedTopPath(100, 24, 6);
    // Two arcs, both in the top band (y ≤ radius) — and none anywhere else.
    const arcs = d.match(/A [^A]*/g) ?? [];
    expect(arcs).toHaveLength(2);
    // It closes along the bottom edge with straight lines only.
    expect(d).toContain('M 0 24');
    expect(d).toContain('L 100 24');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('spans the full box, so the band cannot leave a sliver of paper at its edges', () => {
    // Every extreme of the box is named: a path that stopped short would show through as a line of
    // page down the side of the table, which is the very artifact this replaced.
    const d = roundedTopPath(80, 20, 5);
    expect(d).toContain('L 0 5');
    expect(d).toContain('L 75 0');
    expect(d).toContain('L 80 20');
  });
});

describe('cornerWedgePath', () => {
  it('covers only what the curve removed, never the whole corner square', () => {
    // This patch lands under the repeated table header on a continuation page. A square would cover
    // header band as well as the sliver and nick a light notch out of it — the wedge can only ever
    // repaint what the rounding took away.
    for (const side of ['left', 'right'] as const) {
      const d = cornerWedgePath(6, side);
      // Exactly one arc: the quarter disc being excluded. Three straight edges around it.
      expect((d.match(/A /g) ?? [])).toHaveLength(1);
      expect((d.match(/L /g) ?? [])).toHaveLength(2);
      expect(d.endsWith('Z')).toBe(true);
    }
  });

  it('mirrors the two sides rather than reusing one shape', () => {
    // A corner sliver is not symmetric about the vertical: reusing the left path on the right would
    // fill the quarter disc and leave the sliver open, which is the artifact inverted.
    expect(cornerWedgePath(6, 'left')).not.toBe(cornerWedgePath(6, 'right'));
    // The sweep runs the opposite way on each side — the one thing that makes them mirrors.
    expect(cornerWedgePath(6, 'left')).toContain('0 0 1');
    expect(cornerWedgePath(6, 'right')).toContain('0 0 0');
  });
});

describe('the row fills', () => {
  it('keeps both tones off the paper AND out of grey', () => {
    // The pair has one job each — the lighter tone separates the table from the page, the darker one
    // separates a row from its neighbour. Neither needs a tone dark enough to read as a colour: at
    // 94% the table stopped looking like white paper with ruled rows and became a grey block.
    const green = (hex: string): number => parseInt(hex.slice(3, 5), 16);
    expect(green(ROW_BASE)).toBeLessThan(255);
    expect(green(ROW_ALT)).toBeLessThan(green(ROW_BASE));
    expect(green(ROW_ALT)).toBeGreaterThanOrEqual(240);
  });

  it('stays in the one warm-neutral family the page already has', () => {
    // The family is defined by its HUE, not by a fixed offset: red leads, blue sits halfway to
    // green, and the chroma shrinks as a tone approaches white (ROW_BASE is +2/+1 where the deeper
    // TABLE_HEAD is +4/+2). Asserting the ratio is what makes this a rule about the colour rather
    // than about one of its members — a new tone picked as a flat grey, or with a cool cast, breaks
    // it, and a page that has only ever had one neutral would then have two.
    for (const hex of [ROW_BASE, ROW_ALT, HAIRLINE, TABLE_HEAD]) {
      const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
      expect(r).toBeGreaterThan(g);
      expect(b).toBeGreaterThan(g);
      expect(r - g).toBe((b - g) * 2);
    }
  });
});

describe('the totals panel', () => {
  it('leaves the balance chip exactly the panel width minus its own padding', () => {
    // The chip is an SVG, and an SVG cannot be told to fill its parent — it is drawn at an explicit
    // width. Derive it, or a change to the panel's padding silently leaves the chip too wide (it
    // overflows the rounded corner) or too narrow (it stops looking like a bar).
    expect(TOTALS_INNER_WIDTH).toBe(TOTALS_WIDTH - TOTALS_PADDING * 2);
  });
});
