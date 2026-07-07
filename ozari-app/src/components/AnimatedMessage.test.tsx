import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AnimatedMessage from './AnimatedMessage';

describe('AnimatedMessage', () => {
  it('exposes an alert region with the error styling and reveals the error text', async () => {
    render(<AnimatedMessage errorMessage="Campo requerido" id="field-error" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('id', 'field-error');
    expect(alert).toHaveClass('text-red-600');

    // The visible text is set inside the GSAP crossfade timeline (first fade-out beat), which ticks
    // under jsdom's rAF-driven ticker — wait for it to land on the error message.
    await waitFor(() => expect(alert).toHaveTextContent('Campo requerido'), { timeout: 3000 });
  });

  it('falls back to the focus colour when there is no error, showing the instructions', async () => {
    render(<AnimatedMessage instructions="Escribe tu correo" />);

    const alert = screen.getByRole('alert');
    // No error => not red; default focusColor 'midnight' maps to text-midnight.
    expect(alert).not.toHaveClass('text-red-600');
    expect(alert).toHaveClass('text-midnight');

    await waitFor(() => expect(alert).toHaveTextContent('Escribe tu correo'), { timeout: 3000 });
  });

  it('accepts an explicit focusColor', () => {
    render(<AnimatedMessage instructions="Opcional" focusColor="midnight" />);
    expect(screen.getByRole('alert')).toHaveClass('text-midnight');
  });
});
