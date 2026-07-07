import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PageLoader from './PageLoader';

const setMatchMedia = (reduce: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reduce : !reduce,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

let realMatchMedia: typeof window.matchMedia;
beforeEach(() => {
  realMatchMedia = window.matchMedia; // the setup's reduced-motion mock
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

describe('PageLoader', () => {
  it('renders the branded full-screen loader (static under reduced motion)', () => {
    render(<PageLoader />);
    // The brand mark is exposed as a labelled image (a role="img" wrapper around the inline LogoMark).
    expect(screen.getByRole('img')).toHaveAccessibleName('components.pageLoader.logo');
  });

  it('plays the staggered entrance when motion is allowed', () => {
    setMatchMedia(false);
    render(<PageLoader />);
    // The entrance timeline runs (GSAP's `from` leaves the elements at their hidden start-state in
    // jsdom, since the tween doesn't progress) — query with `hidden` to confirm the mark rendered.
    expect(screen.getByRole('img', { hidden: true })).toBeInTheDocument();
  });
});
