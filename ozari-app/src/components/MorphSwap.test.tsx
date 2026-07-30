import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MorphSwap from './MorphSwap';

describe('MorphSwap', () => {
  it('renders its content plainly when nothing has changed', () => {
    render(<MorphSwap swapKey="a">Pendiente</MorphSwap>);
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.queryByText('Pendiente')?.closest('[aria-hidden]')).toBeNull();
  });

  it('paints old and new TOGETHER while morphing, then drops the old one', async () => {
    const { rerender } = render(<MorphSwap swapKey={1}>Pendiente</MorphSwap>);
    rerender(<MorphSwap swapKey={5}>En ruta</MorphSwap>);

    // Both are in the DOM: that overlap IS the cross-fade (a swap would blank one out first).
    expect(screen.getByText('En ruta')).toBeInTheDocument();
    // The outgoing copy is out of flow and hidden from assistive tech — it's a ghost, not content.
    const outgoing = screen.getByText('Pendiente');
    expect(outgoing).toHaveAttribute('aria-hidden');
    expect(outgoing.className).toContain('absolute');

    await waitFor(() => expect(screen.queryByText('Pendiente')).not.toBeInTheDocument());
    expect(screen.getByText('En ruta')).toBeInTheDocument();
  });

  it('does NOT morph when the key is unchanged (a refetch of equal data)', () => {
    const { rerender } = render(<MorphSwap swapKey="same">Pendiente</MorphSwap>);
    rerender(<MorphSwap swapKey="same">Pendiente</MorphSwap>);
    expect(screen.getAllByText('Pendiente')).toHaveLength(1);
  });

  it('keeps up when the key changes again mid-morph (latest content wins)', async () => {
    const { rerender } = render(<MorphSwap swapKey={1}>Pendiente</MorphSwap>);
    rerender(<MorphSwap swapKey={5}>En ruta</MorphSwap>);
    rerender(<MorphSwap swapKey={3}>Entregado</MorphSwap>);

    await waitFor(() => expect(screen.queryByText('En ruta')).not.toBeInTheDocument());
    expect(screen.getByText('Entregado')).toBeInTheDocument();
    expect(screen.queryByText('Pendiente')).not.toBeInTheDocument();
  });

  it('passes extra classes through to the morphing box', () => {
    render(
      <MorphSwap swapKey="a" className="text-xs">
        Listo
      </MorphSwap>,
    );
    expect(screen.getByText('Listo').parentElement?.className).toContain('text-xs');
  });
});
