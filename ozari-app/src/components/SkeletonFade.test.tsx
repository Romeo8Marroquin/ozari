import { render, screen, waitFor } from '@testing-library/react';
import gsap from 'gsap';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkeletonFade from './SkeletonFade';

const skeleton = <span data-testid="skel">loading</span>;

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

describe('SkeletonFade', () => {
  it('renders the content straight away (no skeleton) when it was never loading', () => {
    render(
      <SkeletonFade loading={false} skeleton={skeleton}>
        <span>Real</span>
      </SkeletonFade>,
    );
    expect(screen.getByText('Real')).toBeInTheDocument();
    expect(screen.queryByTestId('skel')).not.toBeInTheDocument();
  });

  it('shows only the skeleton while loading', () => {
    render(
      <SkeletonFade loading skeleton={skeleton}>
        <span>Real</span>
      </SkeletonFade>,
    );
    expect(screen.getByTestId('skel')).toBeInTheDocument();
    expect(screen.queryByText('Real')).not.toBeInTheDocument();
  });

  it('crossfades: content appears, then the skeleton overlay unmounts after the fade', async () => {
    const { rerender } = render(
      <SkeletonFade loading skeleton={skeleton} durationMs={20}>
        <span>Real</span>
      </SkeletonFade>,
    );
    expect(screen.getByTestId('skel')).toBeInTheDocument();

    rerender(
      <SkeletonFade loading={false} skeleton={skeleton} durationMs={20}>
        <span>Real</span>
      </SkeletonFade>,
    );
    // Content is mounted and crossfades in; the skeleton overlay unmounts once the fade completes.
    expect(screen.getByText('Real')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('skel')).not.toBeInTheDocument());
  });

  it('re-arms the skeleton when it goes back to loading (reused modal reopening / refetch)', async () => {
    // Start already loaded (as a reused instance would, holding stale data): content, no skeleton.
    const { rerender } = render(
      <SkeletonFade loading={false} skeleton={skeleton} durationMs={20}>
        <span>Real</span>
      </SkeletonFade>,
    );
    expect(screen.getByText('Real')).toBeInTheDocument();
    expect(screen.queryByTestId('skel')).not.toBeInTheDocument();

    // Re-enter loading → the skeleton returns (revealed re-armed), not a stuck "already revealed".
    rerender(
      <SkeletonFade loading skeleton={skeleton} durationMs={20}>
        <span>Real</span>
      </SkeletonFade>,
    );
    expect(screen.getByTestId('skel')).toBeInTheDocument();

    // Resolve again → it crossfades exactly like the first time (skeleton overlay unmounts after).
    rerender(
      <SkeletonFade loading={false} skeleton={skeleton} durationMs={20}>
        <span>Real</span>
      </SkeletonFade>,
    );
    expect(screen.getByText('Real')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('skel')).not.toBeInTheDocument());
  });

  describe('animateSize (size morph)', () => {
    let realMatchMedia: typeof window.matchMedia;
    let originalOffsetWidth: PropertyDescriptor | undefined;
    let originalOffsetHeight: PropertyDescriptor | undefined;

    const mockWidth = (get: () => number): void => {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get });
    };
    const mockHeight = (get: () => number): void => {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get });
    };

    beforeEach(() => {
      realMatchMedia = window.matchMedia;
      originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
      originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    });
    afterEach(() => {
      window.matchMedia = realMatchMedia;
      if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
      if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
      vi.restoreAllMocks();
    });

    // A fromTo spy that fires each tween's callbacks and returns a killable stub, so the reveal's
    // opacity + width tweens are inspectable without running real GSAP.
    const spyFromTo = (): ReturnType<typeof vi.spyOn> =>
      vi.spyOn(gsap, 'fromTo').mockImplementation((_targets, _from, vars) => {
        (vars as gsap.TweenVars).onStart?.call(null);
        (vars as gsap.TweenVars).onComplete?.call(null);
        return { kill: vi.fn() } as unknown as gsap.core.Tween;
      });

    // The reveal always fades opacity; the size tweens are the ones whose `from` carries the axis.
    const axisCalls = (spy: ReturnType<typeof vi.spyOn>, axis: 'width' | 'height'): unknown[][] =>
      (spy.mock.calls as unknown[][]).filter((call) => {
        const from = call[1] as Record<string, unknown> | undefined;
        return Boolean(from && axis in from);
      });
    const widthCalls = (spy: ReturnType<typeof vi.spyOn>): unknown[][] => axisCalls(spy, 'width');

    it('crossfades but does NOT morph the width under reduced motion', () => {
      // The global setup reports prefers-reduced-motion: reduce → the fade still runs, no width tween.
      const fromTo = spyFromTo();
      const { rerender } = render(
        <SkeletonFade loading animateSize skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );
      rerender(
        <SkeletonFade loading={false} animateSize skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );
      expect(fromTo).toHaveBeenCalled(); // the opacity crossfade
      expect(widthCalls(fromTo)).toHaveLength(0); // ...but no width morph
    });

    it('does not morph when the skeleton and content widths already match', () => {
      setMatchMedia(false);
      mockWidth(() => 120); // constant width → from === to
      const fromTo = spyFromTo();
      const { rerender } = render(
        <SkeletonFade loading animateSize skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );
      rerender(
        <SkeletonFade loading={false} animateSize skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );
      expect(widthCalls(fromTo)).toHaveLength(0);
    });

    it('eases the wrapper width from the skeleton width to the content width, in step with the fade', () => {
      setMatchMedia(false);
      let width = 100; // skeleton width...
      mockWidth(() => width);
      const fromTo = spyFromTo();

      const { rerender } = render(
        <SkeletonFade loading animateSize durationMs={200} skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );
      width = 200; // ...content is wider once the name lands
      rerender(
        <SkeletonFade loading={false} animateSize durationMs={200} skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );

      const calls = widthCalls(fromTo);
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toEqual({ width: 100 });
      // Same duration as the opacity crossfade → they resize and appear together.
      expect(calls[0][2]).toMatchObject({ width: 200, duration: 0.2 });
    });

    it("accepts 'width' as the explicit string form of the boolean", () => {
      setMatchMedia(false);
      let width = 100;
      mockWidth(() => width);
      const fromTo = spyFromTo();

      const { rerender } = render(
        <SkeletonFade loading animateSize="width" skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );
      width = 200;
      rerender(
        <SkeletonFade loading={false} animateSize="width" skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );

      expect(widthCalls(fromTo)).toHaveLength(1);
      expect(axisCalls(fromTo, 'height')).toHaveLength(0);
    });

    it("eases the wrapper HEIGHT (and only the height) with animateSize='height'", () => {
      setMatchMedia(false);
      let height = 400; // the skeleton column...
      mockHeight(() => height);
      const fromTo = spyFromTo();

      const { rerender } = render(
        <SkeletonFade loading animateSize="height" durationMs={200} skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );
      height = 640; // ...grows to the loaded form
      rerender(
        <SkeletonFade loading={false} animateSize="height" durationMs={200} skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );

      const calls = axisCalls(fromTo, 'height');
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toEqual({ height: 400 });
      expect(calls[0][2]).toMatchObject({ height: 640, duration: 0.2 });
      expect(widthCalls(fromTo)).toHaveLength(0);
    });

    it("morphs BOTH axes with animateSize='both'", () => {
      setMatchMedia(false);
      let size = 100;
      mockWidth(() => size);
      mockHeight(() => size);
      const fromTo = spyFromTo();

      const { rerender } = render(
        <SkeletonFade loading animateSize="both" skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );
      size = 300;
      rerender(
        <SkeletonFade loading={false} animateSize="both" skeleton={skeleton}>
          <span>Real</span>
        </SkeletonFade>,
      );

      expect(widthCalls(fromTo)).toHaveLength(1);
      expect(axisCalls(fromTo, 'height')).toHaveLength(1);
    });
  });
});
