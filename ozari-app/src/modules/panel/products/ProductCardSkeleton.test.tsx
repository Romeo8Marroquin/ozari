import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProductCardSkeleton from './ProductCardSkeleton';

describe('ProductCardSkeleton', () => {
  it('renders a decorative shimmer placeholder (hidden from a11y)', () => {
    const { container } = render(<ProductCardSkeleton />);
    const root = container.firstElementChild;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });
});
