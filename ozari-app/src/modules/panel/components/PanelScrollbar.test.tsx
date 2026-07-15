import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PanelScrollbar, { SCROLLBAR_IDLE_HIDE_MS } from './PanelScrollbar';

/** A stand-in scroll container with controllable metrics (jsdom has no real layout). */
const makeScroller = (options: { scrollHeight: number; clientHeight: number }): HTMLElement => {
  const element = document.createElement('main');
  document.body.appendChild(element);
  Object.defineProperty(element, 'scrollHeight', { value: options.scrollHeight, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: options.clientHeight, configurable: true });
  element.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 800, bottom: options.clientHeight, width: 800, height: options.clientHeight }) as DOMRect;
  element.scrollTop = 0;
  return element;
};

/** Advance the faked clock inside act (timer callbacks set React state). */
const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

const renderBar = (element: HTMLElement) => {
  const target = createRef<HTMLElement>();
  (target as { current: HTMLElement }).current = element;
  const utils = render(<PanelScrollbar target={target} />);
  advance(16); // flush the initial requestAnimationFrame measure
  return utils;
};

const thumb = (): HTMLElement => screen.getByTestId('panel-scrollbar-thumb');

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('PanelScrollbar', () => {
  it('renders NO thumb when the content does not overflow (nothing to scroll)', () => {
    renderBar(makeScroller({ scrollHeight: 500, clientHeight: 500 }));
    expect(screen.queryByTestId('panel-scrollbar-thumb')).not.toBeInTheDocument();
  });

  it('shows a proportional thumb on scroll and fades it after the idle delay', () => {
    const element = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    renderBar(element);

    // Overflowing content mounts the thumb, but it rests INVISIBLE until engaged.
    expect(thumb().className).toContain('opacity-0');

    element.scrollTop = 750; // half-way through the 1500px of scrollable distance
    fireEvent.scroll(element);
    expect(thumb().className).toContain('opacity-100');
    // Track = 500 - 8 inset = 492; thumb = 492 * 500/2000 = 123; offset = (492-123)/2 + 4 = 188.5.
    expect(thumb().style.height).toBe('123px');
    expect(thumb().style.top).toBe('188.5px');

    advance(SCROLLBAR_IDLE_HIDE_MS);
    expect(thumb().className).toContain('opacity-0');
  });

  it('wakes when the pointer approaches the right edge (and not in the middle of the page)', () => {
    const element = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    renderBar(element);

    fireEvent.pointerMove(element, { clientX: 400 }); // middle — no reveal
    expect(thumb().className).toContain('opacity-0');

    fireEvent.pointerMove(element, { clientX: 790 }); // reaching for the edge
    expect(thumb().className).toContain('opacity-100');
  });

  it('stays visible while hovered and fades after leaving', () => {
    const element = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    renderBar(element);
    fireEvent.scroll(element);

    fireEvent.pointerEnter(thumb());
    advance(SCROLLBAR_IDLE_HIDE_MS * 3);
    expect(thumb().className).toContain('opacity-100');

    fireEvent.pointerLeave(thumb());
    advance(SCROLLBAR_IDLE_HIDE_MS);
    expect(thumb().className).toContain('opacity-0');
  });

  it('drags: pointer travel maps to scroll travel, releases on pointerup', () => {
    const element = makeScroller({ scrollHeight: 2000, clientHeight: 500 });
    renderBar(element);
    fireEvent.scroll(element);

    fireEvent.pointerDown(thumb(), { clientY: 100 });
    expect(thumb().className).toContain('bg-charcoal/45'); // the dragging emphasis

    // Track 492, thumb 123 → draggable 369 maps to 1500 scrollable → 36.9px drag ≈ 150px scroll.
    fireEvent.pointerMove(window, { clientY: 136.9 });
    expect(element.scrollTop).toBeCloseTo(150, 0);

    // While dragging, the idle fade never hides the bar.
    advance(SCROLLBAR_IDLE_HIDE_MS * 3);
    expect(thumb().className).toContain('opacity-100');

    fireEvent.pointerUp(window);
    advance(SCROLLBAR_IDLE_HIDE_MS);
    expect(thumb().className).toContain('opacity-0');
  });

  it('resyncs on content resize (skeleton → few products removes the thumb, no layout jump)', () => {
    const element = makeScroller({ scrollHeight: 2000, clientHeight: 500 });

    // A controllable ResizeObserver stub (the global setup one is inert).
    let trigger: (() => void) | null = null;
    const realObserver = window.ResizeObserver;
    window.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        trigger = () => callback([], this as unknown as ResizeObserver);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;

    try {
      renderBar(element);
      expect(screen.getByTestId('panel-scrollbar-thumb')).toBeInTheDocument();

      // The content shrank below the fold — the thumb dissolves instead of a native bar popping out.
      Object.defineProperty(element, 'scrollHeight', { value: 400, configurable: true });
      act(() => trigger!());
      expect(screen.queryByTestId('panel-scrollbar-thumb')).not.toBeInTheDocument();
    } finally {
      window.ResizeObserver = realObserver;
    }
  });

  it('tolerates a missing target (nothing mounted yet)', () => {
    const target = createRef<HTMLElement>();
    expect(() => render(<PanelScrollbar target={target} />)).not.toThrow();
  });
});
