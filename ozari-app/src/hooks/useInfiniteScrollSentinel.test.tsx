import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInfiniteScrollSentinel } from './useInfiniteScrollSentinel';

/** A controllable IntersectionObserver stub: tests fire `intersect()` to simulate reaching it. */
class ObserverStub implements IntersectionObserver {
  static instances: ObserverStub[] = [];
  readonly root = null;
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    private readonly callback: IntersectionObserverCallback,
    public readonly options?: IntersectionObserverInit,
  ) {
    ObserverStub.instances.push(this);
  }
  get rootMargin(): string {
    return this.options?.rootMargin ?? '';
  }
  observe(element: Element): void {
    this.observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  intersect(isIntersecting: boolean): void {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this);
  }
}

const Harness: React.FC<{ onReach: () => void; disabled: boolean }> = ({ onReach, disabled }) => {
  const ref = useInfiniteScrollSentinel({ onReach, disabled });
  return <div ref={ref} data-testid="sentinel" />;
};

const realObserver = window.IntersectionObserver;

beforeEach(() => {
  ObserverStub.instances = [];
  window.IntersectionObserver = ObserverStub as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  window.IntersectionObserver = realObserver;
});

describe('useInfiniteScrollSentinel', () => {
  it('observes the sentinel and fires onReach when it intersects', () => {
    const onReach = vi.fn();
    render(<Harness onReach={onReach} disabled={false} />);

    const observer = ObserverStub.instances[0]!;
    expect(observer.observed).toHaveLength(1);
    expect(observer.rootMargin).toBe('600px 0px');

    observer.intersect(false);
    expect(onReach).not.toHaveBeenCalled();
    observer.intersect(true);
    expect(onReach).toHaveBeenCalledTimes(1);
  });

  it('always calls the LATEST onReach without re-creating the observer', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onReach={first} disabled={false} />);
    rerender(<Harness onReach={second} disabled={false} />);

    expect(ObserverStub.instances).toHaveLength(1);
    ObserverStub.instances[0]!.intersect(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('creates no observer while disabled, and re-arms (a fresh observer) when re-enabled', () => {
    const onReach = vi.fn();
    const { rerender } = render(<Harness onReach={onReach} disabled={true} />);
    expect(ObserverStub.instances).toHaveLength(0);

    rerender(<Harness onReach={onReach} disabled={false} />);
    expect(ObserverStub.instances).toHaveLength(1);

    // Disabling again (a fetch started) disconnects — scrolling can't double-fire.
    rerender(<Harness onReach={onReach} disabled={true} />);
    expect(ObserverStub.instances[0]!.disconnected).toBe(true);
  });

  it('disconnects on unmount', () => {
    const { unmount } = render(<Harness onReach={vi.fn()} disabled={false} />);
    unmount();
    expect(ObserverStub.instances[0]!.disconnected).toBe(true);
  });
});
