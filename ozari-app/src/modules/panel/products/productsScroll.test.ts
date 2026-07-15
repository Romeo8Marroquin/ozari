import { afterEach, describe, expect, it } from 'vitest';
import {
  clearProductsScroll,
  restoreProductsScroll,
  saveProductsScroll,
  scrollPanelToTop,
} from './productsScroll';

/** Mount a stand-in for the panel's scroll container (`main.panel-main`). */
const mountScroller = (scrollTop: number): HTMLElement => {
  const main = document.createElement('main');
  main.className = 'panel-main';
  document.body.appendChild(main);
  main.scrollTop = scrollTop;
  return main;
};

afterEach(() => {
  document.body.innerHTML = '';
  clearProductsScroll();
});

describe('productsScroll', () => {
  it('saves the grid position and restores it ONCE (the restore is one-shot)', () => {
    const main = mountScroller(320);
    saveProductsScroll();

    main.scrollTop = 0; // the detail scrolled to top in between
    restoreProductsScroll();
    expect(main.scrollTop).toBe(320);

    // A second restore has nothing saved — the position must not leak into later arrivals.
    main.scrollTop = 50;
    restoreProductsScroll();
    expect(main.scrollTop).toBe(50);
  });

  it('snaps the panel to the top', () => {
    const main = mountScroller(500);
    scrollPanelToTop();
    expect(main.scrollTop).toBe(0);
  });

  it('clear() forgets a saved position (the cold-arrival path)', () => {
    const main = mountScroller(320);
    saveProductsScroll();
    clearProductsScroll();

    main.scrollTop = 10;
    restoreProductsScroll();
    expect(main.scrollTop).toBe(10);
  });

  it('is a no-op without the scroll container in the DOM', () => {
    expect(() => {
      saveProductsScroll();
      scrollPanelToTop();
      restoreProductsScroll();
    }).not.toThrow();
  });
});
