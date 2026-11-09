import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SketchNote from './SketchNote';

const K = 'modules.panel.orderSketch';
const region = (container: HTMLElement): HTMLElement => container.firstElementChild as HTMLElement;

describe('SketchNote', () => {
  it('is an EMPTY region when there is nothing to say — mounted, so a hint can ease in later', () => {
    const { container } = render(<SketchNote hint={null} needsVariant={false} />);
    expect(region(container)).toBeInTheDocument();
    expect(region(container)).toHaveTextContent(/^$/);
  });

  it('says the cap in a quiet tone, a warning in amber, and the variation still owed', () => {
    const { container, rerender } = render(
      <SketchNote hint={{ text: 'Máx. 4', warn: false }} needsVariant={false} spacing="pt-3" />,
    );
    expect(screen.getByText('Máx. 4')).toHaveClass('text-charcoal/55');
    expect(region(container).querySelector('.pt-3')).not.toBeNull();

    rerender(<SketchNote hint={{ text: 'Solo 2', warn: true }} needsVariant />);
    expect(screen.getByText('Solo 2')).toHaveClass('text-amber-700');
    expect(screen.getByText(`${K}.variantLater`)).toBeInTheDocument();
  });
});
