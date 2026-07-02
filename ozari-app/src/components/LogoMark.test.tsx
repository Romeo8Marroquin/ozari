import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LogoMark from './LogoMark';

describe('LogoMark', () => {
  it('renders a decorative (aria-hidden) inline SVG with the given class', () => {
    const { container } = render(<LogoMark className="w-8 text-charcoal" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveClass('w-8', 'text-charcoal');
  });

  it('inherits color via currentColor', () => {
    const { container } = render(<LogoMark />);
    expect(container.querySelector('svg')).toHaveAttribute('fill', 'currentColor');
  });
});
