import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ErrorScreen from './ErrorScreen';

// The global setup reports `prefers-reduced-motion: reduce = true`, so ErrorScreen renders in its
// final visible state and its GSAP timeline is skipped. A couple of tests below flip that off to
// exercise the animation/exit code paths.
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

afterEach(() => {
  window.matchMedia = reducedMotionMatchMedia;
});

describe('ErrorScreen', () => {
  it('defaults to the crash variant copy', () => {
    render(<ErrorScreen />);
    expect(screen.getByText('errorScreen.crash.title')).toBeInTheDocument();
    expect(screen.getByText('errorScreen.crash.message')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('errorScreen.crash.action');
  });

  it.each(['crash', 'maintenance', 'offline'] as const)('renders the %s variant copy', (variant) => {
    render(<ErrorScreen variant={variant} />);
    expect(screen.getByText(`errorScreen.${variant}.title`)).toBeInTheDocument();
    expect(screen.getByText(`errorScreen.${variant}.message`)).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent(`errorScreen.${variant}.action`);
  });

  it('fills the container instead of the screen when fill="container"', () => {
    const { container } = render(<ErrorScreen fill="container" />);
    const section = container.querySelector('section');
    expect(section).toHaveClass('min-h-full');
    expect(section).not.toHaveClass('min-h-dvh');
  });

  it('fills the viewport by default (fill="screen")', () => {
    const { container } = render(<ErrorScreen />);
    expect(container.querySelector('section')).toHaveClass('min-h-dvh');
  });

  it('renders a custom action slot instead of the default reload button', () => {
    render(<ErrorScreen action={<button type="button">Reintentar</button>} />);
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    // The default action key is not used when a slot is supplied.
    expect(screen.queryByText('errorScreen.crash.action')).not.toBeInTheDocument();
  });

  it('invokes the supplied onAction handler', async () => {
    const onAction = vi.fn();
    render(<ErrorScreen onAction={onAction} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  describe('default reload action', () => {
    const originalLocation = window.location;
    beforeAll(() => {
      Object.defineProperty(window, 'location', { configurable: true, value: { reload: vi.fn() } });
    });
    afterAll(() => {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });

    it('falls back to a full reload when no onAction is given', async () => {
      render(<ErrorScreen />);
      await userEvent.click(screen.getByRole('button'));
      expect(window.location.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('exit behaviour', () => {
    it('calls onExited immediately when hidden under reduced motion (no timeline)', () => {
      const onExited = vi.fn();
      const { rerender } = render(<ErrorScreen visible onExited={onExited} />);
      expect(onExited).not.toHaveBeenCalled();
      rerender(<ErrorScreen visible={false} onExited={onExited} />);
      expect(onExited).toHaveBeenCalledTimes(1);
    });

    it('reverses the entrance timeline and calls onExited when animated', async () => {
      setReducedMotion(false);
      const onExited = vi.fn();
      const { rerender } = render(<ErrorScreen visible onExited={onExited} />);
      // Let the forward timeline advance so the reverse has distance to travel back to the start
      // (reversing from progress 0 never fires onReverseComplete).
      await new Promise((resolve) => setTimeout(resolve, 400));
      rerender(<ErrorScreen visible={false} onExited={onExited} />);
      // The reversed timeline (1.5x speed) ticks to completion via GSAP's rAF ticker.
      await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1), { timeout: 3000 });
    });

    it('cancels the exit and resumes when re-shown mid-reverse', () => {
      setReducedMotion(false);
      const onExited = vi.fn();
      const { rerender } = render(<ErrorScreen visible onExited={onExited} />);
      // Start hiding (kicks off the reverse), then immediately re-show before it completes.
      rerender(<ErrorScreen visible={false} onExited={onExited} />);
      rerender(<ErrorScreen visible onExited={onExited} />);
      // Resuming forward means the exit never completed.
      expect(onExited).not.toHaveBeenCalled();
    });
  });
});
