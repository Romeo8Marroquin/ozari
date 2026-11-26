import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderPaidChip, OrderPaidEdge, OrderProgressRail } from './OrderCardRails';

const segments = () =>
  Array.from(screen.getByTestId('order-progress-rail').children) as HTMLElement[];
const filled = () => segments().filter((segment) => segment.dataset.filled === 'true');

describe('OrderProgressRail', () => {
  it('draws one segment per step of the ORDER’s pipeline and fills up to where it stands', () => {
    render(<OrderProgressRail progress={{ step: 3, total: 5 }} colorKey="emerald" />);
    expect(segments()).toHaveLength(5);
    expect(filled()).toHaveLength(3);
    // The completed segments wear the CURRENT status' colour (the chip's hue); the rest are track.
    expect(filled().every((segment) => segment.className.includes('bg-emerald-400'))).toBe(true);
    expect(segments()[4].className).toContain('bg-charcoal/[0.07]');
  });

  it('a purchase-only order at its finish line is a FULL three-segment rail', () => {
    render(<OrderProgressRail progress={{ step: 3, total: 3 }} colorKey="emerald" />);
    expect(segments()).toHaveLength(3);
    expect(filled()).toHaveLength(3);
  });

  it('staggers the segments bottom-up, so a step forward reads as the colour climbing', () => {
    render(<OrderProgressRail progress={{ step: 2, total: 3 }} colorKey="amber" />);
    expect(segments().map((segment) => segment.style.transitionDelay)).toEqual([
      '0ms',
      '60ms',
      '120ms',
    ]);
  });

  it('turns the whole rail to warning red when overdue — and STILL shows how far it got', () => {
    render(<OrderProgressRail progress={{ step: 3, total: 5 }} colorKey="emerald" overdue />);
    expect(screen.getByTestId('order-progress-rail').dataset.overdue).toBe('true');
    expect(filled()).toHaveLength(3);
    expect(filled().every((segment) => segment.className.includes('bg-red-500'))).toBe(true);
    expect(segments()[4].className).toContain('bg-red-100');
  });

  it('cancelling ON SCREEN drains the segments it had instead of collapsing them', () => {
    const { rerender } = render(
      <OrderProgressRail progress={{ step: 3, total: 5 }} colorKey="emerald" />,
    );
    rerender(<OrderProgressRail colorKey="red" />);
    expect(segments()).toHaveLength(5);
    expect(filled()).toHaveLength(0);
  });

  it('with no position (cancelled) leaves only the quiet empty track', () => {
    render(<OrderProgressRail colorKey="red" />);
    expect(segments()).toHaveLength(1);
    expect(filled()).toHaveLength(0);
  });

  it('an unknown colour token still fills READABLY (neutral, never invisible)', () => {
    render(<OrderProgressRail progress={{ step: 1, total: 5 }} colorKey="fucsia" />);
    expect(filled()[0].className).toContain('bg-charcoal/35');
  });

  it('is decorative — the chip and the countdown carry the same facts in words', () => {
    render(<OrderProgressRail progress={{ step: 1, total: 5 }} />);
    expect(screen.getByTestId('order-progress-rail')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('OrderPaidEdge', () => {
  it('shows the emerald seam once the money is in', () => {
    render(<OrderPaidEdge isPaid />);
    const edge = screen.getByTestId('order-paid-edge');
    expect(edge.dataset.paid).toBe('true');
    expect(edge.className).toContain('opacity-100');
  });

  it('stays mounted but invisible while unpaid, so paying FADES it in instead of popping', () => {
    render(<OrderPaidEdge isPaid={false} />);
    const edge = screen.getByTestId('order-paid-edge');
    expect(edge.dataset.paid).toBe('false');
    expect(edge.className).toContain('opacity-0');
    expect(edge).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('OrderPaidChip', () => {
  it('opens its column and shows "Pagado" once the money is in', () => {
    render(<OrderPaidChip isPaid />);
    const chip = screen.getByTestId('order-paid-chip');
    expect(chip.dataset.paid).toBe('true');
    expect(chip).toHaveClass('grid-cols-[1fr]', 'opacity-100');
    expect(chip).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByText('modules.panel.orders.detail.paid')).toBeInTheDocument();
  });

  it('stays mounted but collapsed and silent while unpaid, so paying SLIDES it in', () => {
    render(<OrderPaidChip isPaid={false} />);
    const chip = screen.getByTestId('order-paid-chip');
    expect(chip).toHaveClass('grid-cols-[0fr]', 'opacity-0');
    expect(chip).toHaveAttribute('aria-hidden', 'true');
  });
});
