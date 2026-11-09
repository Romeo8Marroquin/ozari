import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SketchWindowNote from './SketchWindowNote';

const K = 'modules.panel.orderSketch.window';
const fold = (container: HTMLElement): HTMLElement => container.firstElementChild as HTMLElement;

describe('SketchWindowNote', () => {
  it('stays folded (and silent) while the sketch has no dates', () => {
    const { container } = render(<SketchWindowNote window={null} />);
    expect(fold(container)).toHaveAttribute('aria-hidden', 'true');
    expect(fold(container)).toHaveClass('grid-rows-[0fr]');
  });

  it('opens on the window — a rental range, or a sale’s single date — and keeps it painted as it folds', () => {
    const deliveryAt = new Date('2026-12-01T10:00');
    const { container, rerender } = render(
      <SketchWindowNote window={{ deliveryAt, pickupAt: new Date('2026-12-02T10:00') }} className="mt-3" />,
    );
    expect(fold(container)).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByText(`${K}.range`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.label`, { exact: false }).closest('p')).toHaveClass('mt-3');

    rerender(<SketchWindowNote window={{ deliveryAt, pickupAt: null }} />);
    expect(screen.getByText(`${K}.from`)).toBeInTheDocument();

    rerender(<SketchWindowNote window={null} />);
    expect(fold(container)).toHaveAttribute('aria-hidden', 'true');
    // The last dates stay on screen while the fold closes over them.
    expect(screen.getByText(`${K}.from`)).toBeInTheDocument();
  });
});
