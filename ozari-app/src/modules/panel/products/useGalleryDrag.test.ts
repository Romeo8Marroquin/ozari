import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const motion = vi.hoisted(() => ({
  animateGalleryReorder: vi.fn(),
  captureGalleryLayout: vi.fn(() => ({ captured: true })),
  galleryDragLift: vi.fn(),
  galleryDragMove: vi.fn(),
  galleryDragSettle: vi.fn(() => Promise.resolve()),
  // Identity by default (tests mock static rects anyway); the anti-oscillation test overrides it.
  getTileRestingRect: vi.fn(
    (el: HTMLElement): { left: number; top: number; right: number; bottom: number } =>
      el.getBoundingClientRect(),
  ),
}));
vi.mock('../pageMotion', () => motion);

import { useGalleryDrag } from './useGalleryDrag';
import type { GalleryImage } from './useGalleryImages';

/** A 100×100 tile at (x, y) with the pointer-capture API stubbed (jsdom has none). */
const makeThumb = (left: number, top: number): HTMLLIElement => {
  const el = document.createElement('li');
  el.getBoundingClientRect = vi.fn(
    () => ({ left, top, right: left + 100, bottom: top + 100, width: 100, height: 100, x: left, y: top, toJSON: () => ({}) }) as DOMRect,
  );
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  return el;
};

const image = (id: string): GalleryImage => ({ id, name: `${id}.png`, previewUrl: `blob:${id}` });

type HookProps = { disabled: boolean; images: GalleryImage[] };

const setup = (initial: Partial<HookProps> = {}) => {
  const thumbA = makeThumb(0, 0);
  const thumbB = makeThumb(120, 0);
  const thumbRefs = { current: new Map([['a', thumbA], ['b', thumbB]]) };
  const scopeRef = { current: document.createElement('div') };
  const moveImage = vi.fn();
  const view = renderHook(
    ({ disabled, images }: HookProps) =>
      useGalleryDrag({ disabled, images, moveImage, scopeRef, thumbRefs }),
    { initialProps: { disabled: false, images: [image('a'), image('b')], ...initial } },
  );
  return { ...view, thumbA, thumbB, thumbRefs, scopeRef, moveImage };
};

/** A fabricated React pointer event — handlers are called directly, so no jsdom event limits. */
const pointerEvent = (
  el: HTMLElement,
  overrides: Partial<{
    pointerId: number;
    pointerType: string;
    button: number;
    clientX: number;
    clientY: number;
    target: HTMLElement;
  }> = {},
) =>
  ({
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: 10,
    clientY: 10,
    target: overrides.target ?? el,
    currentTarget: el,
    preventDefault: vi.fn(),
    ...overrides,
  }) as unknown as React.PointerEvent<HTMLElement>;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('useGalleryDrag — starting a drag', () => {
  it('lifts the tile after the movement threshold (a small wiggle stays a click)', () => {
    const { result, thumbA } = setup();
    const handlers = result.current.getThumbHandlers('a');

    act(() => handlers.onPointerDown(pointerEvent(thumbA)));
    expect(thumbA.setPointerCapture).toHaveBeenCalledWith(1);
    expect(result.current.draggingId).toBeNull();

    // 3px of travel — under the threshold, still a click.
    act(() => handlers.onPointerMove(pointerEvent(thumbA, { clientX: 13 })));
    expect(motion.galleryDragLift).not.toHaveBeenCalled();

    // Past the threshold — the tile lifts.
    act(() => handlers.onPointerMove(pointerEvent(thumbA, { clientX: 30 })));
    expect(motion.galleryDragLift).toHaveBeenCalledWith(thumbA);
    expect(result.current.draggingId).toBe('a');
  });

  it('never starts from the tile controls (star/✕), a secondary button, or while disabled', () => {
    const { result, rerender, thumbA } = setup();
    const handlers = result.current.getThumbHandlers('a');

    const button = document.createElement('button');
    thumbA.appendChild(button);
    act(() => handlers.onPointerDown(pointerEvent(thumbA, { target: button })));
    act(() => handlers.onPointerDown(pointerEvent(thumbA, { button: 2 })));
    expect(thumbA.setPointerCapture).not.toHaveBeenCalled();

    rerender({ disabled: true, images: [image('a'), image('b')] });
    act(() => result.current.getThumbHandlers('a').onPointerDown(pointerEvent(thumbA)));
    expect(thumbA.setPointerCapture).not.toHaveBeenCalled();
  });

  it('ignores a second press while a session is in flight, and moves from other pointers', () => {
    const { result, thumbA, thumbB } = setup();
    const handlers = result.current.getThumbHandlers('a');

    act(() => handlers.onPointerDown(pointerEvent(thumbA)));
    act(() => result.current.getThumbHandlers('b').onPointerDown(pointerEvent(thumbB, { pointerId: 2 })));
    expect(thumbB.setPointerCapture).not.toHaveBeenCalled();

    // A move from a DIFFERENT pointer id never advances the session.
    act(() => handlers.onPointerMove(pointerEvent(thumbA, { pointerId: 2, clientX: 90 })));
    expect(motion.galleryDragLift).not.toHaveBeenCalled();
  });
});

describe('useGalleryDrag — touch', () => {
  it('lifts after a still hold; moving early means scrolling and stands down', () => {
    vi.useFakeTimers();
    const { result, thumbA } = setup();
    const handlers = result.current.getThumbHandlers('a');

    // Case 1: still hold → lift.
    act(() => handlers.onPointerDown(pointerEvent(thumbA, { pointerType: 'touch' })));
    act(() => vi.advanceTimersByTime(250));
    expect(motion.galleryDragLift).toHaveBeenCalledWith(thumbA);
    act(() => handlers.onPointerUp(pointerEvent(thumbA)));

    // Case 2: early movement past the scroll tolerance → the press stands down entirely.
    motion.galleryDragLift.mockClear();
    act(() => handlers.onPointerDown(pointerEvent(thumbA, { pointerType: 'touch' })));
    act(() => handlers.onPointerMove(pointerEvent(thumbA, { clientX: 40, pointerType: 'touch' })));
    act(() => vi.advanceTimersByTime(500));
    expect(motion.galleryDragLift).not.toHaveBeenCalled();
  });

  it('tolerates a small wiggle during the hold — the tile still lifts', () => {
    vi.useFakeTimers();
    const { result, thumbA } = setup();
    const handlers = result.current.getThumbHandlers('a');

    act(() => handlers.onPointerDown(pointerEvent(thumbA, { pointerType: 'touch' })));
    // 5px of finger drift — under the scroll tolerance, the hold keeps counting.
    act(() => handlers.onPointerMove(pointerEvent(thumbA, { clientX: 15, pointerType: 'touch' })));
    act(() => vi.advanceTimersByTime(250));
    expect(motion.galleryDragLift).toHaveBeenCalledWith(thumbA);
  });

  it('suppresses page scrolling only while a drag is active (non-passive touchmove)', () => {
    vi.useFakeTimers();
    const { result, thumbA } = setup();
    const handlers = result.current.getThumbHandlers('a');

    act(() => handlers.onPointerDown(pointerEvent(thumbA, { pointerType: 'touch' })));
    act(() => vi.advanceTimersByTime(250));

    // The active drag preventDefaults touchmove, so the browser can't take over scrolling.
    const touchMove = new Event('touchmove', { cancelable: true });
    window.dispatchEvent(touchMove);
    expect(touchMove.defaultPrevented).toBe(true);

    act(() => handlers.onPointerUp(pointerEvent(thumbA)));
    const afterEnd = new Event('touchmove', { cancelable: true });
    window.dispatchEvent(afterEnd);
    expect(afterEnd.defaultPrevented).toBe(false);
  });
});

describe('useGalleryDrag — tracking, reordering, releasing', () => {
  /** Press on 'a' and travel to (x, y) so the drag is active. */
  const dragTo = (
    handlers: ReturnType<ReturnType<typeof setup>['result']['current']['getThumbHandlers']>,
    el: HTMLElement,
    x: number,
    y = 10,
  ): void => {
    act(() => handlers.onPointerDown(pointerEvent(el)));
    act(() => handlers.onPointerMove(pointerEvent(el, { clientX: x, clientY: y })));
  };

  it('pins the tile under the pointer while over no other tile (no reorder)', () => {
    const { result, thumbA, moveImage } = setup();
    const handlers = result.current.getThumbHandlers('a');

    dragTo(handlers, thumbA, 110); // the gap between the tiles
    // Grabbed at (10,10) inside a tile at (0,0): translation = pointer − grab − origin.
    expect(motion.galleryDragMove).toHaveBeenLastCalledWith(thumbA, 100, 0);
    expect(moveImage).not.toHaveBeenCalled();

    // A follow-up move on the already-active drag keeps tracking (and lifts only once). The exact
    // x is not asserted: the mocked rect is static, unlike a real layout where it carries the
    // applied translation — computeDragTranslation's own tests pin the arithmetic.
    act(() => handlers.onPointerMove(pointerEvent(thumbA, { clientX: 111, clientY: 12 })));
    expect(motion.galleryDragMove).toHaveBeenLastCalledWith(thumbA, expect.any(Number), 2);
    expect(motion.galleryDragLift).toHaveBeenCalledTimes(1);
  });

  it('hit-tests RESTING boxes, never live ones — a mid-glide tile cannot re-trigger the swap', () => {
    const { result, thumbA, moveImage } = setup();
    const handlers = result.current.getThumbHandlers('a');

    // Tile b is mid-FLIP: its LIVE box still covers the pointer, but the RESTING box (the cell it
    // is gliding to) sits elsewhere — testing live boxes here is what caused the order to thrash
    // back and forth every pointermove (the "teleporting" bug).
    motion.getTileRestingRect.mockImplementation((el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left + 240, top: rect.top, right: rect.right + 240, bottom: rect.bottom };
    });

    dragTo(handlers, thumbA, 150); // inside b's LIVE box…
    expect(moveImage).not.toHaveBeenCalled(); // …but its resting box says "not there"

    motion.getTileRestingRect.mockImplementation((el: HTMLElement) => el.getBoundingClientRect());
  });

  it('treats a tile whose element is not registered (unmounting mid-drag) as no target', () => {
    const { result, thumbA, thumbRefs, moveImage } = setup();
    const handlers = result.current.getThumbHandlers('a');

    thumbRefs.current.delete('b');
    dragTo(handlers, thumbA, 150); // where b's box would be
    expect(moveImage).not.toHaveBeenCalled();
  });

  it('commits the reorder when crossing another tile, then FLIPs the survivors and re-pins', () => {
    const { result, rerender, thumbA, scopeRef, moveImage } = setup();
    const handlers = result.current.getThumbHandlers('a');

    dragTo(handlers, thumbA, 150); // inside tile b's box
    expect(motion.captureGalleryLayout).toHaveBeenCalledWith(scopeRef.current);
    expect(moveImage).toHaveBeenCalledWith('a', 1);

    // The parent commits the new order → the layout effect re-pins the dragged tile and FLIPs the
    // rest from the captured state.
    motion.galleryDragMove.mockClear();
    rerender({ disabled: false, images: [image('b'), image('a')] });
    expect(motion.galleryDragMove).toHaveBeenCalledWith(thumbA, expect.any(Number), expect.any(Number));
    expect(motion.animateGalleryReorder).toHaveBeenCalledWith(
      scopeRef.current,
      { captured: true },
      thumbA,
    );
  });

  it('a reflow without an active drag never FLIPs (external order changes are not its business)', () => {
    const { rerender } = setup();
    rerender({ disabled: false, images: [image('b'), image('a')] });
    expect(motion.animateGalleryReorder).not.toHaveBeenCalled();
  });

  it('release settles the tile and keeps the elevated styling until it lands', async () => {
    let settle: () => void = () => undefined;
    motion.galleryDragSettle.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    const { result, thumbA } = setup();
    const handlers = result.current.getThumbHandlers('a');

    dragTo(handlers, thumbA, 150);
    act(() => handlers.onPointerUp(pointerEvent(thumbA)));
    expect(motion.galleryDragSettle).toHaveBeenCalledWith(thumbA);
    // Mid-flight the tile still reads as "in hand".
    expect(result.current.draggingId).toBe('a');

    act(() => settle());
    await waitFor(() => expect(result.current.draggingId).toBeNull());
  });

  it("an old settle landing AFTER a new drag started never clears the new tile's styling", async () => {
    let settleFirst: () => void = () => undefined;
    motion.galleryDragSettle.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        settleFirst = resolve;
      }),
    );
    const { result, thumbA, thumbB } = setup();

    // Drag 'a' and release — its settle is still in flight…
    dragTo(result.current.getThumbHandlers('a'), thumbA, 150);
    act(() => result.current.getThumbHandlers('a').onPointerUp(pointerEvent(thumbA)));

    // …while the user already picked up 'b'.
    dragTo(result.current.getThumbHandlers('b'), thumbB, 150, 10);
    expect(result.current.draggingId).toBe('b');

    act(() => settleFirst());
    await waitFor(() => expect(result.current.draggingId).toBe('b'));
  });

  it('a plain click (no activation) releases without any settle choreography', () => {
    const { result, thumbA } = setup();
    const handlers = result.current.getThumbHandlers('a');

    act(() => handlers.onPointerDown(pointerEvent(thumbA)));
    act(() => handlers.onPointerUp(pointerEvent(thumbA)));
    expect(motion.galleryDragSettle).not.toHaveBeenCalled();

    // The session is gone: a later move is inert.
    act(() => handlers.onPointerMove(pointerEvent(thumbA, { clientX: 90 })));
    expect(motion.galleryDragLift).not.toHaveBeenCalled();
  });

  it('pointercancel and an end from a foreign pointer id are handled safely', () => {
    const { result, thumbA } = setup();
    const handlers = result.current.getThumbHandlers('a');

    dragTo(handlers, thumbA, 150);
    // A stray pointerup from another pointer must NOT end the session…
    act(() => handlers.onPointerUp(pointerEvent(thumbA, { pointerId: 9 })));
    expect(motion.galleryDragSettle).not.toHaveBeenCalled();
    // …but the session's own cancel (browser took the gesture) settles cleanly.
    act(() => handlers.onPointerCancel(pointerEvent(thumbA)));
    expect(motion.galleryDragSettle).toHaveBeenCalledWith(thumbA);
  });

  it('freezing the form (disabled) or unmounting abandons an in-flight drag cleanly', () => {
    const { result, rerender, thumbA } = setup();
    dragTo(result.current.getThumbHandlers('a'), thumbA, 150);

    rerender({ disabled: true, images: [image('a'), image('b')] });
    expect(motion.galleryDragSettle).toHaveBeenCalledWith(thumbA);

    // And a drag left dangling at unmount tears down too (no listeners leak).
    motion.galleryDragSettle.mockClear();
    const second = setup();
    dragTo(second.result.current.getThumbHandlers('a'), second.thumbA, 150);
    second.unmount();
    expect(motion.galleryDragSettle).toHaveBeenCalledWith(second.thumbA);
  });
});
