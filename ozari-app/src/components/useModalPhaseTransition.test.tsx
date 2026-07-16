import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// GSAP is mocked so the transition's *logic* (deferred swap, guards, resize branch) is deterministic
// rather than tied to real animation frames: `timeline` completes its out-sweep on a macrotask (so
// the "old content stays while it sweeps out" behaviour is real and observable), and `to` fires its
// height-tween onComplete synchronously.
const gsapMock = vi.hoisted(() => ({
  set: vi.fn(),
  fromTo: vi.fn(),
  to: vi.fn(),
  timeline: vi.fn(),
}));
vi.mock('gsap', () => ({ default: gsapMock }));

// (Re)apply the mock behaviours: the height tween's onComplete fires synchronously; the out-sweep
// timeline completes on a macrotask so the deferred swap is observable. Called from beforeEach so it
// survives `restoreAllMocks` between tests.
const initGsapMock = (): void => {
  gsapMock.set.mockReset();
  gsapMock.fromTo.mockReset();
  gsapMock.to.mockReset().mockImplementation((_targets: unknown, vars?: { onComplete?: () => void }) => {
    vars?.onComplete?.();
    return {};
  });
  // `kill` cancels the pending completion, mirroring real GSAP (a killed sweep never commits).
  gsapMock.timeline.mockReset().mockImplementation((vars?: { onComplete?: () => void }) => {
    const id = setTimeout(() => vars?.onComplete?.(), 0);
    const tl = { to: vi.fn(() => tl), kill: vi.fn(() => clearTimeout(id)) };
    return tl;
  });
};

import { useModalPhaseTransition } from './useModalPhaseTransition';

// The global setup reports `prefers-reduced-motion: reduce = true`; flip it per test to exercise the
// animated path (mirrors the Modal test).
const reducedMotionMatchMedia = window.matchMedia;
const setReducedMotion = (reduce: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const rect = (height: number): DOMRect =>
  ({ height, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

interface HarnessProps {
  target: string;
  withBody?: boolean;
  attachPanel?: boolean;
}

const Harness: React.FC<HarnessProps> = ({ target, withBody = true, attachPanel = true }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const rendered = useModalPhaseTransition(target, panelRef);
  const content = (
    <>
      <h2 className="modal-stagger">{`title-${rendered}`}</h2>
      <div className="modal-stagger-footer">{`footer-${rendered}`}</div>
    </>
  );
  return (
    <div ref={attachPanel ? panelRef : undefined}>
      {withBody ? <div data-modal-body>{content}</div> : content}
    </div>
  );
};

beforeEach(() => initGsapMock());
afterEach(() => {
  window.matchMedia = reducedMotionMatchMedia;
  vi.restoreAllMocks();
});

describe('useModalPhaseTransition', () => {
  it('renders the target immediately on first mount (no transition)', () => {
    render(<Harness target="form" />);
    expect(screen.getByText('title-form')).toBeInTheDocument();
    expect(gsapMock.timeline).not.toHaveBeenCalled();
  });

  it('swaps instantly under reduced motion, without animating', async () => {
    const { rerender } = render(<Harness target="form" />);
    rerender(<Harness target="recovery" />);

    expect(await screen.findByText('title-recovery')).toBeInTheDocument();
    expect(gsapMock.timeline).not.toHaveBeenCalled();
    expect(gsapMock.fromTo).not.toHaveBeenCalled();
  });

  it('swaps instantly when the panel ref is detached, even with motion enabled', async () => {
    setReducedMotion(false);
    const { rerender } = render(<Harness target="form" attachPanel={false} />);
    rerender(<Harness target="recovery" attachPanel={false} />);

    expect(await screen.findByText('title-recovery')).toBeInTheDocument();
    expect(gsapMock.timeline).not.toHaveBeenCalled();
  });

  it('sweeps the old content out, then swaps in the new (no resize when height is unchanged)', async () => {
    setReducedMotion(false);
    const { rerender } = render(<Harness target="form" />);
    rerender(<Harness target="recovery" />);

    // Deferred: the old content is still on screen while it sweeps out.
    expect(screen.getByText('title-form')).toBeInTheDocument();
    expect(screen.queryByText('title-recovery')).not.toBeInTheDocument();
    expect(gsapMock.timeline).toHaveBeenCalledTimes(1);

    // ...then the new content commits and sweeps in.
    expect(await screen.findByText('title-recovery')).toBeInTheDocument();
    expect(gsapMock.fromTo).toHaveBeenCalled();
    // jsdom reports height 0 for both, so the resize branch is skipped.
    expect(gsapMock.set).not.toHaveBeenCalled();
  });

  it('a rapid re-flip mid-sweep kills the pending sweep so only the LATEST phase commits', async () => {
    setReducedMotion(false);
    const { rerender } = render(<Harness target="form" />);
    rerender(<Harness target="recovery" />); // sweep 1 starts (commit pending on a macrotask)
    rerender(<Harness target="third" />); // re-flip mid-sweep: sweep 1 must be killed, sweep 2 starts

    const firstSweep = gsapMock.timeline.mock.results[0].value as { kill: ReturnType<typeof vi.fn> };
    expect(firstSweep.kill).toHaveBeenCalled();
    expect(gsapMock.timeline).toHaveBeenCalledTimes(2);

    // Only the latest target ever lands — the intermediate phase never commits.
    expect(await screen.findByText('title-third')).toBeInTheDocument();
    expect(screen.queryByText('title-recovery')).not.toBeInTheDocument();
  });

  it('pins the start height, clips the body, and tweens to the new height when it changes', async () => {
    setReducedMotion(false);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValueOnce(rect(100)) // `from`, captured before the out-sweep
      .mockReturnValue(rect(200)); // `to`, measured after the swap
    const { rerender } = render(<Harness target="form" />);
    rerender(<Harness target="recovery" />);

    expect(await screen.findByText('title-recovery')).toBeInTheDocument();
    expect(gsapMock.set).toHaveBeenCalledWith(expect.anything(), { height: 100 });
    expect(gsapMock.set).toHaveBeenCalledWith(expect.anything(), { overflow: 'hidden' });
    expect(gsapMock.to).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ height: 200 }),
    );
    // The height tween's onComplete (fired synchronously by the mock) clears the body clip.
    expect(gsapMock.set).toHaveBeenCalledWith(expect.anything(), { clearProps: 'overflow' });
  });

  it('resizes without a modal-body element present, skipping the body clip', async () => {
    setReducedMotion(false);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValueOnce(rect(100))
      .mockReturnValue(rect(200));
    const { rerender } = render(<Harness target="form" withBody={false} />);
    rerender(<Harness target="recovery" withBody={false} />);

    expect(await screen.findByText('title-recovery')).toBeInTheDocument();
    expect(gsapMock.set).toHaveBeenCalledWith(expect.anything(), { height: 100 });
    expect(gsapMock.to).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ height: 200 }),
    );
    // No `[data-modal-body]` → the overflow clip/clear is never applied.
    expect(gsapMock.set).not.toHaveBeenCalledWith(expect.anything(), { overflow: 'hidden' });
    expect(gsapMock.set).not.toHaveBeenCalledWith(expect.anything(), { clearProps: 'overflow' });
  });
});
