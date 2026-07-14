import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The role drives which ACTIONS the glass overlay offers — drive it directly.
const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useRole }));

import { Role } from '@constants/Roles';
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

const K = 'modules.panel.products';
const STOCK = {
  count: `${K}.stock.count`,
  available: `${K}.stock.available`,
  out: `${K}.stock.out`,
};
const ACTIONS = {
  edit: `${K}.card.actions.edit`,
  delete: `${K}.card.actions.delete`,
  order: `${K}.card.actions.order`,
};

beforeEach(() => {
  vi.clearAllMocks();
  useRole.mockReturnValue(null);
});

const card = (): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`${K}.card.viewDetails`) });

describe('ProductCard', () => {
  it('renders ONE copy of each essential — the info transforms in place, it is never duplicated', () => {
    render(<ProductCard product={{ ...base, description: 'Mesa para 8 personas' }} />);
    expect(screen.getAllByText('Mesa redonda')).toHaveLength(1);
    expect(screen.getAllByText('Mesas')).toHaveLength(1);
    expect(screen.getAllByText('Q75 / Día')).toHaveLength(1);
    expect(screen.getByText('Alquiler')).toBeInTheDocument();
    expect(screen.getByText('Mesa para 8 personas')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn/mesa.webp');
  });

  it('is a focusable view-details control: click/Enter/Space toggle the reveal, blur retracts it', async () => {
    render(<ProductCard product={base} />);
    const article = card();
    expect(article).toHaveAttribute('tabindex', '0');
    expect(article).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(article);
    expect(article).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(article, { key: 'Enter' });
    expect(article).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(article, { key: ' ' });
    expect(article).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(article, { key: 'a' }); // unrelated key changes nothing
    expect(article).toHaveAttribute('aria-expanded', 'true');

    // Focus leaving the card entirely retracts the reveal (the touch "tap elsewhere" close).
    fireEvent.blur(article, { relatedTarget: document.body });
    expect(article).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the reveal pinned while interacting with an action (clicks never bubble)', async () => {
    useRole.mockReturnValue(Role.Admin);
    render(<ProductCard product={base} />);
    const article = card();
    await userEvent.click(article);
    expect(article).toHaveAttribute('aria-expanded', 'true');

    // Clicking an action must NOT toggle the card underneath it.
    await userEvent.click(screen.getByRole('button', { name: new RegExp(ACTIONS.edit) }));
    expect(article).toHaveAttribute('aria-expanded', 'true');
    // Focus moving WITHIN the card (to the action) doesn't retract either.
    fireEvent.blur(article, {
      relatedTarget: screen.getByRole('button', { name: new RegExp(ACTIONS.edit) }),
    });
    expect(article).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the brand mark placeholder and no price when there is no image or price', () => {
    const bare: Product = { ...base, rentPrice: undefined, rentTimeUnit: undefined, images: [] };
    const { container } = render(<ProductCard product={bare} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByText(/Q\d/)).not.toBeInTheDocument();
  });

  it('falls back to a friendly line when the product has no description', () => {
    render(<ProductCard product={base} />);
    expect(screen.getByText(`${K}.card.noDescription`)).toBeInTheDocument();
  });

  it('shows the exact count for Admin (quantity present) and "out" at zero', () => {
    render(<ProductCard product={{ ...base, quantity: 40, inStock: true }} />);
    expect(screen.getAllByText(STOCK.count).length).toBeGreaterThan(0);

    render(<ProductCard product={{ ...base, quantity: 0, inStock: false }} />);
    expect(screen.getAllByText(STOCK.out).length).toBeGreaterThan(0);
  });

  it('shows an availability signal for Employee (inStock, no quantity) and "out" when not', () => {
    render(<ProductCard product={{ ...base, inStock: true }} />);
    expect(screen.getAllByText(STOCK.available).length).toBeGreaterThan(0);

    render(<ProductCard product={{ ...base, inStock: false }} />);
    expect(screen.getAllByText(STOCK.out).length).toBeGreaterThan(0);
  });

  it('shows no stock chip when neither role-gated field is present (Client projection)', () => {
    render(<ProductCard product={base} />);
    expect(screen.queryByText(STOCK.count)).not.toBeInTheDocument();
    expect(screen.queryByText(STOCK.available)).not.toBeInTheDocument();
    expect(screen.queryByText(STOCK.out)).not.toBeInTheDocument();
  });

  it('offers edit + delete on the glass for an Admin', () => {
    useRole.mockReturnValue(Role.Admin);
    render(<ProductCard product={base} />);
    expect(screen.getByRole('button', { name: new RegExp(ACTIONS.edit) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(ACTIONS.delete) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(ACTIONS.order) })).not.toBeInTheDocument();
  });

  it('offers order on the glass for a Client', () => {
    useRole.mockReturnValue(Role.Client);
    render(<ProductCard product={base} />);
    expect(screen.getByRole('button', { name: new RegExp(ACTIONS.order) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(ACTIONS.edit) })).not.toBeInTheDocument();
  });

  it('offers no actions for an Employee — information only (the card itself stays focusable)', () => {
    useRole.mockReturnValue(Role.Employee);
    render(<ProductCard product={base} />);
    // The ONLY button is the card's own view-details control — no edit/delete/order.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: new RegExp(ACTIONS.edit) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(ACTIONS.order) })).not.toBeInTheDocument();
  });
});
