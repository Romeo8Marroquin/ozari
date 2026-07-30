import { afterEach, describe, expect, it } from 'vitest';
import { revealInScroller } from './pageMotion';

/**
 * `pageMotion` is coverage-excluded as visual-only orchestration, and it mostly is. `revealInScroller`
 * is the exception worth pinning: it makes a DECISION (which ancestor scrolls, and by how much) whose
 * failure modes are silent — scrolling the wrong container, scrolling too far and pushing a tall form's
 * first field off screen, or scrolling when nothing needed it.
 *
 * The suite runs reduced-motion, so the helper takes its instant path and the resulting `scrollTop` is
 * directly assertable.
 */

/** jsdom lays nothing out, so both boxes are stated explicitly. */
const withRect = (element: HTMLElement, top: number, bottom: number): HTMLElement => {
  element.getBoundingClientRect = () =>
    ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top }) as DOMRect;
  return element;
};

/** A scrolling box with one child, at the given geometry. */
const mount = (
  view: [number, number],
  child: [number, number],
  { scrolls = true, scrollTop = 0 } = {},
): { scroller: HTMLElement; row: HTMLElement } => {
  const scroller = document.createElement('div');
  if (scrolls) scroller.style.overflowY = 'auto';
  const row = document.createElement('div');
  scroller.appendChild(row);
  document.body.appendChild(scroller);
  withRect(scroller, view[0], view[1]);
  withRect(row, child[0], child[1]);
  scroller.scrollTop = scrollTop;
  return { scroller, row };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('revealInScroller', () => {
  it('scrolls the MINIMUM needed to clear the fold, plus a margin', () => {
    // Viewport 0–500, row 400–620: 120px hang over the edge, +24 margin ⇒ 144.
    const { scroller, row } = mount([0, 500], [400, 620], { scrollTop: 100 });
    revealInScroller(row);
    expect(scroller.scrollTop).toBe(244);
  });

  it("never scrolls past the element's own top — a tall form keeps its first field", () => {
    // The row is TALLER than the viewport (30–900 in a 0–500 box). Scrolling by the full overflow
    // would put its first field above the fold, which is the opposite of revealing it: the cap is the
    // headroom above the row (30 - 0 - 24 = 6).
    const { scroller, row } = mount([0, 500], [30, 900]);
    revealInScroller(row);
    expect(scroller.scrollTop).toBe(6);
  });

  it('leaves the scroll alone when the element already fits', () => {
    const { scroller, row } = mount([0, 500], [100, 300], { scrollTop: 40 });
    revealInScroller(row);
    expect(scroller.scrollTop).toBe(40);
  });

  it('leaves it alone when the element is already ABOVE the fold — nothing to reveal downward', () => {
    // Removal and upward moves are deliberately not handled: the height eases shut and the browser's
    // own clamp rides down with it, so a second motion there would compete with the first.
    const { scroller, row } = mount([0, 500], [-200, 620], { scrollTop: 80 });
    revealInScroller(row);
    expect(scroller.scrollTop).toBe(80);
  });

  it('picks the NEAREST scrolling ancestor, so a dialog body wins over the page', () => {
    // This is what lets one helper serve both a panel page and a modal.
    const page = document.createElement('div');
    page.style.overflowY = 'auto';
    const { scroller: body, row } = mount([0, 400], [300, 500]);
    page.appendChild(body);
    document.body.appendChild(page);
    withRect(page, 0, 1000);
    revealInScroller(row);
    expect(body.scrollTop).toBe(124);
    expect(page.scrollTop).toBe(0);
  });

  it('no-ops without a scrolling ancestor, and without an element', () => {
    const { scroller, row } = mount([0, 500], [400, 620], { scrolls: false });
    revealInScroller(row);
    expect(scroller.scrollTop).toBe(0);
    expect(() => revealInScroller(null)).not.toThrow();
  });
});
