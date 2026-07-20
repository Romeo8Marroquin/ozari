import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProductsStatus from './ProductsStatus';

describe('ProductsStatus', () => {
  it('renders the empty tone with title, description, and optional action', () => {
    render(
      <ProductsStatus
        tone="empty"
        title="Sin productos"
        description="Aún no hay nada"
        action={<button type="button">add</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Sin productos' })).toBeInTheDocument();
    expect(screen.getByText('Aún no hay nada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'add' })).toBeInTheDocument();
  });

  it('renders the error tone without an action', () => {
    const { container } = render(
      <ProductsStatus tone="error" title="Falló" description="Intenta de nuevo" />,
    );
    expect(screen.getByRole('heading', { name: 'Falló' })).toBeInTheDocument();
    // The error tone renders its own (attention) icon and no action button.
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the config tone (setup state) with its own icon and an action', () => {
    const { container } = render(
      <ProductsStatus
        tone="config"
        title="Falta configuración"
        description="Configúralo en preferencias"
        action={<button type="button">prefs</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Falta configuración' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'prefs' })).toBeInTheDocument();
  });
});
