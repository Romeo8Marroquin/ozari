import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FormError from './FormError';

describe('FormError', () => {
  it('shows the message and is exposed to assistive tech when present', () => {
    const { container } = render(<FormError message="Credenciales inválidas" id="e" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Credenciales inválidas');
    // outer collapsible wrapper is visible (not hidden) when there's a message
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'false');
  });

  it('collapses (aria-hidden) when there is no message', () => {
    const { container } = render(<FormError message={undefined} id="e" />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the last message painted while collapsing (no text flash to empty)', () => {
    const { container, rerender } = render(<FormError message="Sigue fallando" id="e" />);
    rerender(<FormError message={undefined} id="e" />);
    // still shows the last text, but collapsed
    expect(screen.getByText('Sigue fallando')).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
});
