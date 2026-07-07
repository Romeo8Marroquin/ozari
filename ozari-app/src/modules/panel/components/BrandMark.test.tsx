import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BrandMark from './BrandMark';

describe('BrandMark', () => {
  it('renders the LogoMark inside the decorative tile and forwards className', () => {
    const { container } = render(<BrandMark className="custom-class" />);
    const tile = container.firstChild as HTMLElement;
    expect(tile).toHaveClass('custom-class');
    expect(tile).toHaveAttribute('aria-hidden'); // purely decorative
    expect(container.querySelector('svg')).toBeInTheDocument(); // the isotype
  });
});
