import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The GSAP choreography lives in pageMotion (coverage-excluded, verified by eye); the component's
// STATE logic — when to mount layers, measure, arm and drop the overlay — is what these tests own.
const { revealSectionContent, cleanup } = vi.hoisted(() => ({
  revealSectionContent: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock('../pageMotion', () => ({ revealSectionContent }));

import SectionReveal from './SectionReveal';

const skeleton = <span data-testid="skel">shimmer</span>;

type RevealOptions = {
  skeletonHeight: number;
  delaySeconds: number;
  onSettled: () => void;
  itemSelector?: string;
};
const lastOptions = (): RevealOptions =>
  revealSectionContent.mock.calls[revealSectionContent.mock.calls.length - 1]?.[3] as RevealOptions;

beforeEach(() => {
  vi.clearAllMocks();
  revealSectionContent.mockReturnValue(cleanup);
});

describe('SectionReveal', () => {
  it('shows only the skeleton while loading (children not mounted)', () => {
    render(
      <SectionReveal loading skeleton={skeleton}>
        <span>Real</span>
      </SectionReveal>,
    );
    expect(screen.getByTestId('skel')).toBeInTheDocument();
    expect(screen.queryByText('Real')).not.toBeInTheDocument();
    expect(revealSectionContent).not.toHaveBeenCalled();
  });

  it('renders the content directly on a warm mount — no overlay, no reveal', () => {
    render(
      <SectionReveal loading={false} skeleton={skeleton}>
        <span>Real</span>
      </SectionReveal>,
    );
    expect(screen.getByText('Real')).toBeInTheDocument();
    expect(screen.queryByTestId('skel')).not.toBeInTheDocument();
    expect(revealSectionContent).not.toHaveBeenCalled();
  });

  it('plays the reveal on load: overlay mounted, measured height + delay passed, settled drops it', () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 420 });

    const { rerender } = render(
      <SectionReveal loading skeleton={skeleton} delaySeconds={0.16}>
        <span>Real</span>
      </SectionReveal>,
    );
    rerender(
      <SectionReveal loading={false} skeleton={skeleton} delaySeconds={0.16}>
        <span>Real</span>
      </SectionReveal>,
    );

    // Content took the flow; the skeleton became the fading overlay on top of it.
    expect(screen.getByText('Real')).toBeInTheDocument();
    expect(screen.getByTestId('skel')).toBeInTheDocument();
    expect(revealSectionContent).toHaveBeenCalledTimes(1);
    expect(lastOptions()).toMatchObject({ skeletonHeight: 420, delaySeconds: 0.16 });
    // No override → the choreography falls back to its own `.reveal-item` default.
    expect(lastOptions()).not.toHaveProperty('itemSelector');

    // The choreography reports settled → the overlay unmounts.
    act(() => lastOptions().onSettled());
    expect(screen.queryByTestId('skel')).not.toBeInTheDocument();

    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    }
  });

  it('forwards a custom itemSelector to the choreography (the page-scale reveal)', () => {
    const { rerender } = render(
      <SectionReveal loading skeleton={skeleton} itemSelector=".reveal-block">
        <span>Real</span>
      </SectionReveal>,
    );
    rerender(
      <SectionReveal loading={false} skeleton={skeleton} itemSelector=".reveal-block">
        <span>Real</span>
      </SectionReveal>,
    );
    expect(lastOptions()).toMatchObject({ itemSelector: '.reveal-block' });
    act(() => lastOptions().onSettled());
  });

  it('re-arms when loading returns (a refetch): skeleton back, then a second reveal', () => {
    const { rerender } = render(
      <SectionReveal loading skeleton={skeleton}>
        <span>Real</span>
      </SectionReveal>,
    );
    rerender(
      <SectionReveal loading={false} skeleton={skeleton}>
        <span>Real</span>
      </SectionReveal>,
    );
    act(() => lastOptions().onSettled());

    rerender(
      <SectionReveal loading skeleton={skeleton}>
        <span>Real</span>
      </SectionReveal>,
    );
    expect(screen.getByTestId('skel')).toBeInTheDocument();
    expect(screen.queryByText('Real')).not.toBeInTheDocument();

    rerender(
      <SectionReveal loading={false} skeleton={skeleton}>
        <span>Real</span>
      </SectionReveal>,
    );
    expect(revealSectionContent).toHaveBeenCalledTimes(2);
  });

  it('kills the choreography via its cleanup when unmounted mid-reveal', () => {
    const { rerender, unmount } = render(
      <SectionReveal loading skeleton={skeleton}>
        <span>Real</span>
      </SectionReveal>,
    );
    rerender(
      <SectionReveal loading={false} skeleton={skeleton}>
        <span>Real</span>
      </SectionReveal>,
    );
    expect(revealSectionContent).toHaveBeenCalled();

    unmount();
    expect(cleanup).toHaveBeenCalled();
  });
});
