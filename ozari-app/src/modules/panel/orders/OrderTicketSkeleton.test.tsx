import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useBreakpoint from '@hooks/useBreakpoint';
import OrderTicketSkeleton from './OrderTicketSkeleton';

// The skeleton mirrors the ticket's two layouts by width — cover both so the crossfade stays
// congruent on every view (portrait phone → stacked, wider → rail).
vi.mock('@hooks/useBreakpoint', () => ({
  default: vi.fn(() => ({ isMobile: true, breakpoint: 'base' })),
}));
const mockBreakpoint = vi.mocked(useBreakpoint);
beforeEach(() => mockBreakpoint.mockReturnValue({ isMobile: true, breakpoint: 'base' }));

describe('OrderTicketSkeleton', () => {
  it('renders the compact (stacked) placeholder on a portrait phone', () => {
    const { container } = render(<OrderTicketSkeleton />);
    expect(container.querySelector('[aria-hidden]')).toBeInTheDocument();
    // No left rail (no border-r column) on the stacked layout.
    expect(container.querySelector('.border-r')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the roomy rail placeholder on wider screens', () => {
    mockBreakpoint.mockReturnValue({ isMobile: false, breakpoint: 'lg' });
    const { container } = render(<OrderTicketSkeleton />);
    expect(container.querySelector('[aria-hidden]')).toBeInTheDocument();
    // The rail layout has the left time column with its dividing border.
    expect(container.querySelector('.border-r')).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });
});
