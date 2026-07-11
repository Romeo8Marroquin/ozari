import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProductCard from './ProductCard';
import type { Product } from './product.types';

const base: Product = {
  id: 1,
  name: 'Mesa redonda',
  businessType: 'Alquiler',
  category: 'Mesas',
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 75,
  rentTimeUnit: 'Día',
  images: [{ id: 9, url: 'https://cdn/mesa.webp', isPrimary: true, sortOrder: 0 }],
  details: [],
};

const STOCK = {
  count: 'modules.panel.products.stock.count',
  available: 'modules.panel.products.stock.available',
  out: 'modules.panel.products.stock.out',
};

describe('ProductCard', () => {
  it('renders the shared catalog fields and the primary image', () => {
    render(<ProductCard product={base} />);
    expect(screen.getByText('Mesa redonda')).toBeInTheDocument();
    expect(screen.getByText('Mesas')).toBeInTheDocument();
    expect(screen.getByText('Alquiler')).toBeInTheDocument();
    expect(screen.getByText('Q75 / Día')).toBeInTheDocument();
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://cdn/mesa.webp');
  });

  it('shows the brand mark placeholder and no price when there is no image or price', () => {
    const bare: Product = { ...base, rentPrice: undefined, rentTimeUnit: undefined, images: [] };
    const { container } = render(<ProductCard product={bare} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByText(/Q\d/)).not.toBeInTheDocument();
  });

  it('shows the exact count for Admin (quantity present, in stock)', () => {
    render(<ProductCard product={{ ...base, quantity: 40, inStock: true }} />);
    expect(screen.getByText(STOCK.count)).toBeInTheDocument();
  });

  it('shows "out" for Admin when the quantity is zero', () => {
    render(<ProductCard product={{ ...base, quantity: 0, inStock: false }} />);
    expect(screen.getByText(STOCK.out)).toBeInTheDocument();
    expect(screen.queryByText(STOCK.count)).not.toBeInTheDocument();
  });

  it('shows an availability signal for Employee (inStock, no quantity)', () => {
    render(<ProductCard product={{ ...base, inStock: true }} />);
    expect(screen.getByText(STOCK.available)).toBeInTheDocument();
  });

  it('shows "out" for Employee when not in stock', () => {
    render(<ProductCard product={{ ...base, inStock: false }} />);
    expect(screen.getByText(STOCK.out)).toBeInTheDocument();
  });

  it('shows no stock badge for Client (neither field present)', () => {
    render(<ProductCard product={base} />);
    expect(screen.queryByText(STOCK.count)).not.toBeInTheDocument();
    expect(screen.queryByText(STOCK.available)).not.toBeInTheDocument();
    expect(screen.queryByText(STOCK.out)).not.toBeInTheDocument();
  });
});
