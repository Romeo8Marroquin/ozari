import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CrossfadeImage from './CrossfadeImage';

const layers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-layer]'));
const kinds = (container: HTMLElement) => layers(container).map((layer) => layer.dataset.layer);
const isShown = (layer: HTMLElement) => layer.className.split(' ').includes('opacity-100');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CrossfadeImage', () => {
  it('paints the quiet EMPTY tile, or the brand mark when something without a photo is chosen', () => {
    const { container, rerender } = render(<CrossfadeImage empty className="size-12" />);
    expect(kinds(container)).toEqual(['empty']);
    expect(isShown(layers(container)[0])).toBe(true);
    // Decorative: the name is always printed beside it.
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toHaveClass('size-12');

    vi.useFakeTimers();
    rerender(<CrossfadeImage className="size-12" />);
    // The brand layer fades in OVER the empty one; the empty one goes once the fade is done.
    expect(kinds(container)).toEqual(['empty', 'brand']);
    act(() => vi.advanceTimersByTime(300));
    expect(kinds(container)).toEqual(['brand']);
  });

  it('fades a photo in only once it has LOADED, then drops what it covered', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<CrossfadeImage empty />);
    rerender(<CrossfadeImage src="https://cdn/a.webp" />);
    const [empty, photo] = layers(container);
    expect(photo.dataset.layer).toBe('photo');
    // Still loading: invisible, and the empty tile keeps showing underneath — no blank box.
    expect(isShown(photo)).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(layers(container)).toHaveLength(2);

    fireEvent.load(photo.querySelector('img') as HTMLImageElement);
    expect(isShown(photo)).toBe(true);
    expect(isShown(empty)).toBe(true); // covered, not removed — until the fade has finished
    act(() => vi.advanceTimersByTime(300));
    expect(kinds(container)).toEqual(['photo']);
    // A repeated load signal changes nothing.
    fireEvent.load(container.querySelector('img') as HTMLImageElement);
    expect(kinds(container)).toEqual(['photo']);
  });

  it('turns a photo that fails into the brand placeholder, never a broken image', () => {
    const { container } = render(<CrossfadeImage src="https://cdn/broken.webp" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(kinds(container)).toEqual(['brand']);
    expect(isShown(layers(container)[0])).toBe(true);
  });

  it('a newer picture arriving mid-fade cancels the cleanup; ITS fade clears everything below', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<CrossfadeImage empty />);
    rerender(<CrossfadeImage />); // brand, shown at once
    act(() => vi.advanceTimersByTime(100));
    rerender(<CrossfadeImage src="https://cdn/b.webp" />);
    act(() => vi.advanceTimersByTime(500));
    expect(kinds(container)).toEqual(['empty', 'brand', 'photo']);
    fireEvent.load(container.querySelector('img') as HTMLImageElement);
    act(() => vi.advanceTimersByTime(300));
    expect(kinds(container)).toEqual(['photo']);
  });

  it('a quick there-and-back drops the layer that never got to show', () => {
    const { container, rerender } = render(<CrossfadeImage empty />);
    rerender(<CrossfadeImage src="https://cdn/c.webp" />);
    expect(kinds(container)).toEqual(['empty', 'photo']);
    rerender(<CrossfadeImage empty />);
    expect(kinds(container)).toEqual(['empty']);
  });

  it('shows a photo the browser already had decoded without waiting for an event', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(120);
    const { container } = render(<CrossfadeImage src="https://cdn/cached.webp" />);
    expect(isShown(layers(container)[0])).toBe(true);
  });
});
