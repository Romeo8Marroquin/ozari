import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const motion = vi.hoisted(() => ({ reduced: true }));
vi.mock('@utils/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/motion')>()),
  prefersReducedMotion: () => motion.reduced,
}));

import Collapse from './Collapse';

const outer = (container: HTMLElement): HTMLElement => container.firstElementChild as HTMLElement;

afterEach(() => {
  motion.reduced = true;
});

describe('Collapse', () => {
  it('eases open and shut through its grid row, inert and hidden while closed', () => {
    const { container, rerender } = render(
      <Collapse open className="extra" closedClassName="-mt-3">
        <p>nota</p>
      </Collapse>,
    );
    expect(outer(container)).toHaveClass('grid-rows-[1fr]', 'opacity-100', 'extra');
    expect(outer(container)).not.toHaveClass('-mt-3');
    expect(outer(container)).toHaveAttribute('aria-hidden', 'false');

    rerender(
      <Collapse open={false} className="extra" closedClassName="-mt-3">
        <p>nota</p>
      </Collapse>,
    );
    expect(outer(container)).toHaveClass('grid-rows-[0fr]', 'opacity-0', '-mt-3');
    expect(outer(container)).toHaveAttribute('aria-hidden', 'true');
    expect(outer(container)).toHaveAttribute('inert');
    // Content passed while closed stays mounted (a block that keeps state).
    expect(screen.getByText('nota')).toBeInTheDocument();
  });

  it('renders nothing closed without content, and no stray class without the optional props', () => {
    const { container } = render(<Collapse open={false} />);
    expect(outer(container).textContent).toBe('');
    expect(outer(container).className).not.toContain('undefined');
  });

  it('drops a closed note at once when motion is reduced', () => {
    const { rerender } = render(<Collapse open>{<p>nota</p>}</Collapse>);
    rerender(<Collapse open={false}>{false}</Collapse>);
    expect(screen.queryByText('nota')).not.toBeInTheDocument();
  });

  it('keeps painting the last open note through the closing ease, then lets it go', () => {
    motion.reduced = false;
    const { container, rerender } = render(<Collapse open>{<p>primera</p>}</Collapse>);
    rerender(<Collapse open>{<p>segunda</p>}</Collapse>);
    rerender(<Collapse open={false}>{null}</Collapse>);
    expect(screen.getByText('segunda')).toBeInTheDocument();

    // Only the OUTER box's own opacity transition ends the ease — a child's, or another property,
    // does not.
    fireEvent.transitionEnd(screen.getByText('segunda'), { propertyName: 'opacity' });
    fireEvent.transitionEnd(outer(container), { propertyName: 'grid-template-rows' });
    expect(screen.getByText('segunda')).toBeInTheDocument();
    fireEvent.transitionEnd(outer(container), { propertyName: 'opacity' });
    expect(screen.queryByText('segunda')).not.toBeInTheDocument();
  });

  it('ignores the end of an OPENING ease', () => {
    motion.reduced = false;
    const { container } = render(<Collapse open>{<p>nota</p>}</Collapse>);
    fireEvent.transitionEnd(outer(container), { propertyName: 'opacity' });
    expect(screen.getByText('nota')).toBeInTheDocument();
  });
});
