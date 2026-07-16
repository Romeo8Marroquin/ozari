import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The role drives which ACTIONS the glass overlay offers — drive it directly.
const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useRole }));

// The card navigates through the panel transition, saves the grid scroll, and lifts the morph off.
const { panelNavigate } = vi.hoisted(() => ({ panelNavigate: vi.fn() }));
vi.mock('../PanelNavContext', () => ({ usePanelNavigate: () => panelNavigate }));
const { beginProductImageMorph, estimateDetailHeroRect } = vi.hoisted(() => ({
  beginProductImageMorph: vi.fn(),
  estimateDetailHeroRect: vi.fn(),
}));
vi.mock('./productImageMorph', () => ({ beginProductImageMorph, estimateDetailHeroRect }));
const { saveProductsScroll } = vi.hoisted(() => ({ saveProductsScroll: vi.fn() }));
vi.mock('./productsScroll', () => ({ saveProductsScroll }));

import { Role } from '@constants/Roles';
import ProductCard from './ProductCard';
import type { Product } from './product.types';

const base: Product = {
  id: 1,
  name: 'Mesa redonda',
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Mesas',
  categoryId: 1,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 75,
  rentTimeUnit: 'Día',
  images: [{ id: 9, url: 'https://cdn/mesa.webp', isPrimary: true, sortOrder: 0 }],
  details: [],
};

const K = 'modules.panel.products';
const STOCK = {
  count: `${K}.stock.count`,
  countOfTotalShort: `${K}.stock.countOfTotalShort`,
  available: `${K}.stock.available`,
  out: `${K}.stock.out`,
  unavailable: `${K}.stock.unavailable`,
};
const ACTIONS = {
  rent: `${K}.card.actions.rent`,
  buy: `${K}.card.actions.buy`,
};

beforeEach(() => {
  vi.clearAllMocks();
  useRole.mockReturnValue(null);
  estimateDetailHeroRect.mockReturnValue(null);
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

  it('is a REAL stretched button that NAVIGATES to the detail and lifts off the morph', async () => {
    render(<ProductCard product={base} />);
    const viewDetails = card();
    expect(viewDetails.tagName).toBe('BUTTON'); // native semantics — Enter/Space/focus for free

    await userEvent.click(viewDetails);
    expect(panelNavigate).toHaveBeenCalledWith('/panel/productos/1');
    // The grid's scroll is remembered for the return trip.
    expect(saveProductsScroll).toHaveBeenCalled();
    // The morph begins with the SHARED "animation id" (the product id) + the tagged photo, and
    // starts travelling toward the PREDICTED hero rect right on the click.
    estimateDetailHeroRect.mockReturnValue({ left: 1, top: 2, width: 3, height: 4 });
    await userEvent.click(viewDetails);
    expect(beginProductImageMorph).toHaveBeenLastCalledWith(
      1,
      screen.getByRole('img'),
      { left: 1, top: 2, width: 3, height: 4 },
    );
    expect(screen.getByRole('img')).toHaveAttribute('data-morph-id', '1');
  });

  it('still begins the (no-op) morph without a photo — the module handles the null', async () => {
    render(<ProductCard product={{ ...base, images: [] }} />);
    await userEvent.click(card());
    expect(beginProductImageMorph).toHaveBeenCalledWith(1, null, null);
    expect(panelNavigate).toHaveBeenCalledWith('/panel/productos/1');
  });


  it('never navigates from an action press (siblings, never nested; propagation stopped)', async () => {
    useRole.mockReturnValue(Role.Client);
    render(<ProductCard product={base} />);
    const viewDetails = card();

    const rent = screen.getByRole('button', { name: new RegExp(ACTIONS.rent) });
    expect(rent.parentElement?.contains(viewDetails)).toBe(false); // no nested interactive
    await userEvent.click(rent);
    expect(panelNavigate).not.toHaveBeenCalled();
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

  it('shows the takeable count when `available` arrives without `total` (Admin on Venta)', () => {
    render(<ProductCard product={{ ...base, available: 40, inStock: true }} />);
    expect(screen.getAllByText(STOCK.count).length).toBeGreaterThan(0);
  });

  it('words ZERO by business type: Alquiler = "No disponible" (frees later), Venta = "Agotado"', () => {
    // The base fixture is Alquiler — a fully-booked fleet is NOT "agotado", the units come back.
    render(<ProductCard product={{ ...base, available: 0, inStock: false }} />);
    expect(screen.getAllByText(STOCK.unavailable).length).toBeGreaterThan(0);
    expect(screen.queryByText(STOCK.out)).not.toBeInTheDocument();

    render(
      <ProductCard
        product={{ ...base, businessType: 'Venta', available: 0, inStock: false }}
      />,
    );
    expect(screen.getAllByText(STOCK.out).length).toBeGreaterThan(0);
  });

  it('shows the SHORT fleet view "X de Y" when `total` rides along (Admin, Alquiler) — even at 0', () => {
    render(<ProductCard product={{ ...base, available: 35, total: 40, inStock: true }} />);
    expect(screen.getAllByText(STOCK.countOfTotalShort).length).toBeGreaterThan(0);

    // Fully rented ≠ gone: the admin keeps seeing both numbers, in the "out" (amber) tone.
    render(<ProductCard product={{ ...base, available: 0, total: 40, inStock: false }} />);
    expect(screen.getAllByText(STOCK.countOfTotalShort).length).toBeGreaterThan(0);
    expect(screen.queryByText(STOCK.out)).not.toBeInTheDocument();
    expect(screen.queryByText(STOCK.unavailable)).not.toBeInTheDocument();
  });

  it('shows an availability signal for the bare inStock fallback, worded by type when off', () => {
    render(<ProductCard product={{ ...base, inStock: true }} />);
    expect(screen.getAllByText(STOCK.available).length).toBeGreaterThan(0);

    render(<ProductCard product={{ ...base, inStock: false }} />);
    expect(screen.getAllByText(STOCK.unavailable).length).toBeGreaterThan(0);

    render(<ProductCard product={{ ...base, businessType: 'Venta', inStock: false }} />);
    expect(screen.getAllByText(STOCK.out).length).toBeGreaterThan(0);
  });

  it('shows no stock chip when neither role-gated field is present (Client projection)', () => {
    render(<ProductCard product={base} />);
    expect(screen.queryByText(STOCK.count)).not.toBeInTheDocument();
    expect(screen.queryByText(STOCK.available)).not.toBeInTheDocument();
    expect(screen.queryByText(STOCK.out)).not.toBeInTheDocument();
  });

  it('offers NO actions to an Admin — "Ordenar" is gone (Epic-2A); management lives on the detail page', () => {
    useRole.mockReturnValue(Role.Admin);
    render(<ProductCard product={base} />);
    // The ONLY button is the card's own view-details control.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: new RegExp(ACTIONS.rent) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(ACTIONS.buy) })).not.toBeInTheDocument();
  });

  it('offers the business-type CTA to a Client: "Rentar" for Alquiler, "Comprar" for Venta', () => {
    useRole.mockReturnValue(Role.Client);
    const { unmount } = render(<ProductCard product={base} />); // base = Alquiler
    expect(screen.getByRole('button', { name: new RegExp(ACTIONS.rent) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(ACTIONS.buy) })).not.toBeInTheDocument();
    unmount();

    render(
      <ProductCard
        product={{ ...base, businessType: 'Venta', rentPrice: undefined, rentTimeUnit: undefined, sellPrice: 900 }}
      />,
    );
    expect(screen.getByRole('button', { name: new RegExp(ACTIONS.buy) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(ACTIONS.rent) })).not.toBeInTheDocument();
  });

  it('offers no actions while signed-out/unreadable (role null) — the card itself stays focusable', () => {
    render(<ProductCard product={base} />);
    // The ONLY button is the card's own view-details control.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: new RegExp(ACTIONS.rent) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(ACTIONS.buy) })).not.toBeInTheDocument();
  });
});
