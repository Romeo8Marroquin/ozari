/**
 * Per-page scroll for the products flow. The panel has ONE scroll container (`main.panel-main`) that
 * every page shares, so navigating grid → detail used to keep the grid's scroll (the detail opened
 * scrolled down) and returning lost the user's place. These helpers give the two bound pages their
 * own scroll story:
 *
 *  - the card click SAVES the grid's position and the detail SNAPS to the top on mount (pre-paint,
 *    so it's never seen — and the morph's landing rects are measured at the top, always consistent);
 *  - returning RESTORES the saved position BEFORE the returning clone measures its landing card, so
 *    the image flies to where the card actually is;
 *  - a cold return (cache expired → skeletons) CLEARS the stale position instead — that arrival is
 *    a fresh list from the top, like the deep-link it effectively is.
 */

/** The panel's single scroll container. */
function scroller(): HTMLElement | null {
  return document.querySelector('main.panel-main');
}

let savedGridScroll: number | null = null;

/** Card click (grid → detail): remember where the catalog was scrolled. */
export function saveProductsScroll(): void {
  savedGridScroll = scroller()?.scrollTop ?? null;
}

/** Detail mount: a new page starts at the top — instant and pre-paint, never a visible jump. */
export function scrollPanelToTop(): void {
  const element = scroller();
  if (element) element.scrollTop = 0;
}

/** Grid return: put the catalog back where the user left it (one-shot; no-op when nothing saved). */
export function restoreProductsScroll(): void {
  const element = scroller();
  if (element && savedGridScroll !== null) element.scrollTop = savedGridScroll;
  savedGridScroll = null;
}

/** A cold grid arrival must not inherit a stale position later — forget it. */
export function clearProductsScroll(): void {
  savedGridScroll = null;
}
