import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The component keys everything on the router's pathname — a controllable mock.
const route = vi.hoisted(() => ({ pathname: '/panel/productos' }));
vi.mock('@tanstack/react-router', () => ({
  useLocation: ({ select }: { select: (l: { pathname: string }) => string }) =>
    select({ pathname: route.pathname }),
}));

import PanelScrollMemory from './PanelScrollMemory';

/** A stand-in scroller whose scrollTop is freely assignable (jsdom never clamps it). */
const makeScroller = () => {
  const el = document.createElement('main');
  document.body.appendChild(el);
  return { current: el };
};

const setScroll = (el: HTMLElement, top: number): void => {
  el.scrollTop = top;
  fireEvent.scroll(el);
};

beforeEach(() => {
  route.pathname = '/panel/productos';
});

describe('PanelScrollMemory', () => {
  it('remembers each path independently and restores on return; unknown paths open at the top', () => {
    const target = makeScroller();
    const { rerender, unmount } = render(<PanelScrollMemory target={target} />);

    // Scroll the grid, then leave for a page never visited — it opens at the top.
    setScroll(target.current, 480);
    route.pathname = '/panel/productos/nuevo';
    rerender(<PanelScrollMemory target={target} />);
    expect(target.current.scrollTop).toBe(0);

    // Scroll the form, come back to the grid — ITS position returns, not the form's.
    setScroll(target.current, 1200);
    route.pathname = '/panel/productos';
    rerender(<PanelScrollMemory target={target} />);
    expect(target.current.scrollTop).toBe(480);

    // And back to the form again — its own position too.
    route.pathname = '/panel/productos/nuevo';
    rerender(<PanelScrollMemory target={target} />);
    expect(target.current.scrollTop).toBe(1200);

    unmount();
  });

  it('forgets everything when the panel unmounts (logout — positions are per-user)', () => {
    const target = makeScroller();
    const { unmount } = render(<PanelScrollMemory target={target} />);
    setScroll(target.current, 300);
    unmount();

    const fresh = makeScroller();
    fresh.current.scrollTop = 999;
    render(<PanelScrollMemory target={fresh} />);
    expect(fresh.current.scrollTop).toBe(0); // nothing remembered → top
  });
});
