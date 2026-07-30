import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fitImageBox } from '@utils/lightboxLayout';
import ImageLightbox from './ImageLightbox';

// The viewer only ever needs a `url` — a product image, an order's step evidence, anything.
const images = [
  { url: 'https://cdn/a.webp' },
  { url: 'https://cdn/b.webp' },
  { url: 'https://cdn/c.webp' },
];

const K = 'components.lightbox';

const renderBox = (overrides: { images?: { url: string }[]; initialIndex?: number } = {}) => {
  const onClose = vi.fn();
  const utils = render(
    <ImageLightbox
      images={overrides.images ?? images}
      initialIndex={overrides.initialIndex ?? 0}
      label="Mesa redonda"
      onClose={onClose}
    />,
  );
  return { ...utils, onClose };
};

const img = (): HTMLImageElement => screen.getByTestId('lightbox-image');

beforeEach(() => vi.clearAllMocks());

describe('fitImageBox', () => {
  it('fits portrait, landscape, and degenerate sizes inside the bounds, aspect-true', () => {
    // Portrait 3:4 inside 900×600 → height-bound: 450×600.
    expect(fitImageBox(300, 400, 900, 600)).toEqual({ width: 450, height: 600 });
    // Landscape 2:1 inside 900×600 → width-bound: 900×450.
    expect(fitImageBox(800, 400, 900, 600)).toEqual({ width: 900, height: 450 });
    // Unloaded metadata (0×0) falls back to the full bounds.
    expect(fitImageBox(0, 0, 900, 600)).toEqual({ width: 900, height: 600 });
  });
});

describe('ImageLightbox', () => {
  it('renders the dialog with the counter, starts at the initial image, focuses close', () => {
    renderBox({ initialIndex: 1 });
    expect(screen.getByRole('dialog', { name: 'Mesa redonda' })).toBeInTheDocument();
    expect(img()).toHaveAttribute('src', 'https://cdn/b.webp');
    expect(screen.getByText(`${K}.counter`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${K}.close` })).toHaveFocus();
  });

  it('pages FINITELY with the arrows (disabled at the ends), fading between images', async () => {
    renderBox();
    const prev = screen.getByRole('button', { name: `${K}.previous` });
    const next = screen.getByRole('button', { name: `${K}.next` });
    expect(prev).toBeDisabled();

    await userEvent.click(next);
    await waitFor(() => expect(img()).toHaveAttribute('src', 'https://cdn/b.webp'));
    await userEvent.click(next);
    await waitFor(() => expect(img()).toHaveAttribute('src', 'https://cdn/c.webp'));
    expect(next).toBeDisabled();
    expect(prev).toBeEnabled();

    await userEvent.click(prev);
    await waitFor(() => expect(img()).toHaveAttribute('src', 'https://cdn/b.webp'));
  });

  it('pages with the keyboard arrows — clamped at both ends', async () => {
    renderBox();
    fireEvent.keyDown(document, { key: 'ArrowLeft' }); // already at the first image — clamped
    expect(img()).toHaveAttribute('src', 'https://cdn/a.webp');

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    await waitFor(() => expect(img()).toHaveAttribute('src', 'https://cdn/b.webp'));
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    await waitFor(() => expect(img()).toHaveAttribute('src', 'https://cdn/c.webp'));
    fireEvent.keyDown(document, { key: 'ArrowRight' }); // last image — clamped
    expect(img()).toHaveAttribute('src', 'https://cdn/c.webp');

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    await waitFor(() => expect(img()).toHaveAttribute('src', 'https://cdn/b.webp'));
  });

  it('pages on SWIPE (past the threshold) and ignores a mere tap', async () => {
    renderBox();
    const frame = screen.getByTestId('lightbox-frame');

    fireEvent.pointerDown(frame, { clientX: 300 });
    fireEvent.pointerUp(frame, { clientX: 200 }); // left swipe → next
    await waitFor(() => expect(img()).toHaveAttribute('src', 'https://cdn/b.webp'));

    fireEvent.pointerDown(frame, { clientX: 200 });
    fireEvent.pointerUp(frame, { clientX: 300 }); // right swipe → previous
    await waitFor(() => expect(img()).toHaveAttribute('src', 'https://cdn/a.webp'));

    fireEvent.pointerDown(frame, { clientX: 200 });
    fireEvent.pointerUp(frame, { clientX: 210 }); // below the threshold — nothing
    expect(img()).toHaveAttribute('src', 'https://cdn/a.webp');
  });

  it('a press starting on an ARROW is a click, never a swipe — the frame must not capture it', async () => {
    renderBox();
    const frame = screen.getByTestId('lightbox-frame');
    const next = screen.getByRole('button', { name: `${K}.next` });
    const capture = vi.fn();
    (frame as HTMLElement & { setPointerCapture: (id: number) => void }).setPointerCapture = capture;

    // The press bubbles from the button to the frame; capturing there would retarget the
    // pointerup and suppress the button's CLICK (the desktop "arrows do nothing" bug).
    fireEvent.pointerDown(next, { clientX: 300, pointerId: 1 });
    expect(capture).not.toHaveBeenCalled();
    fireEvent.pointerUp(frame, { clientX: 200, pointerId: 1 }); // big travel — still not a swipe
    expect(img()).toHaveAttribute('src', 'https://cdn/a.webp');

    // …while a press on the photo itself DOES capture (the swipe path keeps working off-photo).
    fireEvent.pointerDown(frame, { clientX: 300, pointerId: 2 });
    expect(capture).toHaveBeenCalledWith(2);
    fireEvent.pointerUp(frame, { clientX: 200, pointerId: 2 });
    await waitFor(() => expect(img()).toHaveAttribute('src', 'https://cdn/b.webp'));
  });

  it('a second finger (pinch) or a cancelled pointer ABANDONS the swipe — zoom stays native', async () => {
    renderBox();
    const frame = screen.getByTestId('lightbox-frame');

    // Pinch: two fingers down — even a big horizontal travel must NOT page.
    fireEvent.pointerDown(frame, { clientX: 300, pointerId: 1 });
    fireEvent.pointerDown(frame, { clientX: 320, pointerId: 2 });
    fireEvent.pointerUp(frame, { clientX: 100, pointerId: 2 });
    fireEvent.pointerUp(frame, { clientX: 100, pointerId: 1 });
    expect(img()).toHaveAttribute('src', 'https://cdn/a.webp');

    // A cancelled pointer (the browser took the gesture over) resets cleanly…
    fireEvent.pointerDown(frame, { clientX: 300, pointerId: 3 });
    fireEvent.pointerCancel(frame, { pointerId: 3 });
    // …and the NEXT swipe works normally.
    fireEvent.pointerDown(frame, { clientX: 300, pointerId: 4 });
    fireEvent.pointerUp(frame, { clientX: 200, pointerId: 4 });
    await waitFor(() => expect(img()).toHaveAttribute('src', 'https://cdn/b.webp'));
  });

  it('EASES the frame to each image’s fitted box when it loads', async () => {
    renderBox();
    Object.defineProperty(img(), 'naturalWidth', { value: 300, configurable: true });
    Object.defineProperty(img(), 'naturalHeight', { value: 400, configurable: true });
    fireEvent.load(img());

    const frame = screen.getByTestId('lightbox-frame');
    // jsdom: 1024×768 viewport → bounds 942.08×660.48 → portrait 3:4 fits ≈495×660 (gsap rounds).
    await waitFor(() => expect(parseFloat(frame.style.width)).toBeCloseTo(495.36, 0));
    expect(parseFloat(frame.style.height)).toBeCloseTo(660.48, 0);
  });

  it('dismisses via Escape, the backdrop, and the ✕ — exactly one onClose per lifecycle', async () => {
    const first = renderBox();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' }); // double-press never double-fires
    await waitFor(() => expect(first.onClose).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = renderBox();
    fireEvent.click(screen.getByTestId('lightbox-backdrop'));
    await waitFor(() => expect(second.onClose).toHaveBeenCalledTimes(1));
    second.unmount();

    const third = renderBox();
    await userEvent.click(screen.getByRole('button', { name: `${K}.close` }));
    await waitFor(() => expect(third.onClose).toHaveBeenCalledTimes(1));
  });

  it('traps Tab among its controls (wraps both directions)', () => {
    // Start mid-gallery so BOTH arrows are enabled: focusables = [close, previous, next].
    renderBox({ initialIndex: 1 });
    const buttons = screen.getAllByRole('button');
    const last = buttons[buttons.length - 1]!;

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: `${K}.close` })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    // Mid-cycle Tab (not at either end) is the browser's business — the trap stays out of it.
    const middle = screen.getByRole('button', { name: `${K}.previous` }); // enabled, neither end
    middle.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(middle).toHaveFocus();
  });

  it('runs the full choreography with REAL tweens when motion is allowed (enter/page/fit/close)', async () => {
    const realMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false, // motion allowed
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      const { onClose } = renderBox();

      fireEvent.keyDown(document, { key: 'ArrowRight' }); // page (0.14s out, then swap)
      await waitFor(() => expect(img()).toHaveAttribute('src', 'https://cdn/b.webp'), { timeout: 2000 });

      Object.defineProperty(img(), 'naturalWidth', { value: 400, configurable: true });
      Object.defineProperty(img(), 'naturalHeight', { value: 300, configurable: true });
      fireEvent.load(img()); // fit (0.25s frame ease)
      const frame = screen.getByTestId('lightbox-frame');
      // Landscape 4:3 inside 942.08×660.48 → height-bound: ≈880.64×660.48.
      await waitFor(() => expect(parseFloat(frame.style.width)).toBeCloseTo(880.64, 0), { timeout: 2000 });

      fireEvent.keyDown(document, { key: 'Escape' }); // close (0.18s)
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 2000 });
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it('hides the arrows and counter for a single image, locks scroll while open', () => {
    const { unmount } = renderBox({ images: [images[0]!] });
    expect(screen.queryByRole('button', { name: `${K}.next` })).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.counter`)).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
