import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The query drives every state — mock it so we can pin loading / data / empty / error.
const { useProducts } = vi.hoisted(() => ({ useProducts: vi.fn() }));
vi.mock('./useProducts', () => ({ useProducts }));

// RoleGate's visibility is what makes the "add" affordance Admin-only — drive it directly.
// (`useRole` feeds the card's glass actions; null = no actions, which these tests don't exercise.)
const { useHasRole } = vi.hoisted(() => ({ useHasRole: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useHasRole, useRole: () => null }));

import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import { PanelPageTransitionContext, type PanelPageMotion } from '../PanelPageTransitionContext';
import type { Product } from './product.types';
import ProductsPage from './ProductsPage';

const product = (id: number, name: string): Product => ({
  id,
  name,
  businessType: 'Alquiler',
  category: 'Mesas',
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 75,
  rentTimeUnit: 'Día',
  images: [],
  details: [],
});

type State = {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  refetch?: () => void;
};

const setProducts = (state: State): (() => void) => {
  const refetch = state.refetch ?? vi.fn();
  useProducts.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    refetch,
  });
  return refetch;
};

const withProducts = (products: Product[]) => ({
  data: { products, pagination: { page: 1, pageSize: 15, total: products.length, totalPages: 1 } },
});

const renderPage = () => {
  let motion: PanelPageMotion | null = null;
  const register = (value: PanelPageMotion | null): void => {
    if (value) motion = value;
  };
  const navigate = vi.fn();
  const nav: PanelNav = { navigateTo: navigate, pending: null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PanelNavContext.Provider value={nav}>
      <PanelPageTransitionContext.Provider value={register}>{children}</PanelPageTransitionContext.Provider>
    </PanelNavContext.Provider>
  );
  const utils = render(<ProductsPage />, { wrapper });
  return { ...utils, navigate, registeredMotion: () => motion };
};

const K = 'modules.panel.products';
const addName = `${K}.add`;
const cardName = `${K}.card.viewDetails`;

beforeEach(() => {
  vi.clearAllMocks();
  useHasRole.mockReturnValue(false); // default: non-admin
});
afterEach(() => vi.restoreAllMocks());

describe('ProductsPage', () => {
  it('shows the staggered skeleton grid while the first page loads', () => {
    setProducts({ data: undefined, isLoading: true, isFetching: true });
    renderPage();

    expect(screen.getByRole('status', { name: `${K}.loading` })).toBeInTheDocument();
    // The header row is on screen from the FIRST frame (it needs no data), so the grid never
    // jumps down later to make room for it.
    expect(screen.getByText(`${K}.lead`)).toBeInTheDocument();
    // No real cards, and no add button for a (default) non-admin.
    expect(screen.queryByRole('button', { name: new RegExp(cardName) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: addName })).not.toBeInTheDocument();
  });

  it('renders the populated grid with the header lead (no add button for a non-admin)', () => {
    setProducts(withProducts([product(1, 'Mesa redonda'), product(2, 'Silla Tiffany')]));
    renderPage();

    // The lead/header only appears when there IS a catalog to explore. Each card paints its name
    // on both the scrim and the glass overlay, hence getAllByText.
    expect(screen.getByText(`${K}.lead`)).toBeInTheDocument();
    expect(screen.getAllByText('Mesa redonda').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Silla Tiffany').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: new RegExp(cardName) })).toHaveLength(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: addName })).not.toBeInTheDocument();
  });

  it('shows the Admin add button and navigates to the create page through the panel transition', async () => {
    useHasRole.mockReturnValue(true);
    setProducts(withProducts([product(1, 'Mesa redonda')]));
    const { navigate } = renderPage();

    const add = screen.getByRole('button', { name: addName });
    await userEvent.click(add);
    expect(navigate).toHaveBeenCalledWith('/panel/productos/nuevo');
  });

  it('shows the neutral empty state for a non-admin (no CTA)', () => {
    setProducts(withProducts([]));
    renderPage();

    expect(screen.getByRole('heading', { name: `${K}.empty.title` })).toBeInTheDocument();
    expect(screen.getByText(`${K}.empty.description`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: addName })).not.toBeInTheDocument();
  });

  it('shows the Admin empty state with a single first-product CTA (no header chrome)', () => {
    useHasRole.mockReturnValue(true);
    setProducts(withProducts([]));
    renderPage();

    expect(screen.getByRole('heading', { name: `${K}.empty.adminTitle` })).toBeInTheDocument();
    // The empty catalog stands alone — no top "explore" lead, and exactly ONE add button (the CTA).
    expect(screen.queryByText(`${K}.lead`)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: addName })).toHaveLength(1);
  });

  it('shows the cold-error state and retries via refetch', async () => {
    const refetch = setProducts({ data: undefined, isError: true, isFetching: false });
    renderPage();

    expect(screen.getByRole('heading', { name: `${K}.error.title` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${K}.error.retry` }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('lands the grid (with its entrance) when a retry succeeds straight from the error panel', () => {
    setProducts({ data: undefined, isError: true, isFetching: false });
    const { rerender } = renderPage();
    expect(screen.getByRole('heading', { name: `${K}.error.title` })).toBeInTheDocument();

    // No skeleton phase in between — the grid arrives directly from the settled panel.
    setProducts(withProducts([product(1, 'Mesa redonda')]));
    rerender(<ProductsPage />);

    expect(screen.queryByRole('heading', { name: `${K}.error.title` })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: new RegExp(cardName) })).toHaveLength(1);
  });

  it('hands the skeleton off to the resolved grid when loading completes', async () => {
    setProducts({ data: undefined, isLoading: true, isFetching: true });
    const { rerender } = renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Data arrives → the paired slot CROSSFADES into its card in place (instant under reduced
    // motion) and the orphan skeletons sweep out.
    setProducts(withProducts([product(1, 'Mesa redonda')]));
    rerender(<ProductsPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getAllByText('Mesa redonda').length).toBeGreaterThan(0);
    // The orphan skeleton cells finish their sweep and unmount — only the card slot remains.
    await waitFor(() =>
      expect(document.querySelectorAll('.product-skel-orphan')).toHaveLength(0),
    );
    expect(screen.getAllByRole('button', { name: new RegExp(cardName) })).toHaveLength(1);
  });

  it('sweeps in surplus cards when the data outnumbers the skeleton slots', async () => {
    setProducts({ data: undefined, isLoading: true, isFetching: true });
    const { rerender } = renderPage();

    // 13 products vs 12 skeleton slots → the 13th card is a late entry (`.grid-enter` sweep-in).
    const many = Array.from({ length: 13 }, (_, i) => product(i + 1, `Producto ${i + 1}`));
    setProducts(withProducts(many));
    rerender(<ProductsPage />);

    await waitFor(() => expect(screen.getAllByRole('button', { name: new RegExp(cardName) })).toHaveLength(13));
  });

  it('sweeps ALL skeletons out before the empty panel when the load resolves to nothing', async () => {
    setProducts({ data: undefined, isLoading: true, isFetching: true });
    const { rerender } = renderPage();

    setProducts(withProducts([]));
    rerender(<ProductsPage />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: `${K}.empty.title` })).toBeInTheDocument(),
    );
    expect(document.querySelectorAll('.product-skel')).toHaveLength(0);
  });

  it('sweeps ALL skeletons out before the error panel when the load fails cold', async () => {
    setProducts({ data: undefined, isLoading: true, isFetching: true });
    const { rerender } = renderPage();

    setProducts({ data: undefined, isError: true });
    rerender(<ProductsPage />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: `${K}.error.title` })).toBeInTheDocument(),
    );
    expect(document.querySelectorAll('.product-skel')).toHaveLength(0);
  });

  it('brings the skeleton back if the list drops into a cold reload', async () => {
    setProducts(withProducts([product(1, 'Mesa redonda')]));
    const { rerender } = renderPage();
    expect(screen.getAllByText('Mesa redonda').length).toBeGreaterThan(0);

    setProducts({ data: undefined, isLoading: true, isFetching: true });
    rerender(<ProductsPage />);

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.queryByText('Mesa redonda')).not.toBeInTheDocument();
  });

  it('registers a motion pair whose exit resolves and whose enter replays the reveal', async () => {
    setProducts(withProducts([product(1, 'Mesa redonda')]));
    const { registeredMotion } = renderPage();
    // Reduced motion (the global setup) short-circuits both: the exit resolves, the enter snaps.
    await expect(registeredMotion()!.exit()).resolves.toBeUndefined();
    expect(() => registeredMotion()!.enter({ fromCurrent: true })).not.toThrow();
  });
});
