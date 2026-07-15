import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The query drives every state — mock it so we can pin loading / data / empty / error.
const { useProducts } = vi.hoisted(() => ({ useProducts: vi.fn() }));
vi.mock('./useProducts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useProducts')>()),
  useProducts,
}));

// RoleGate's visibility is what makes the "add" affordance Admin-only — drive it directly.
// (`useRole` feeds the card's glass actions; null = no actions, which these tests don't exercise.)
const { useHasRole } = vi.hoisted(() => ({ useHasRole: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useHasRole, useRole: () => null }));

// The page owns the URL round-trip; the filter bar's own behaviour has its own suite. The stub can
// fire a canned change so the page's `applyFilters` (incl. the `replace` path) is exercised.
vi.mock('./ProductsFilterBar', () => ({
  default: ({ onChange }: { onChange: (next: object, options?: { replace?: boolean }) => void }) => (
    <button
      type="button"
      data-testid="filterbar-apply"
      onClick={() => onChange({ q: 'mesa' }, { replace: true })}
    >
      filterbar
    </button>
  ),
}));

// The shared-element morph + per-page scroll: the page's ARRIVAL decisions are what these tests pin
// (a cold grid dismisses the clone and forgets the scroll; a warm one restores THEN claims).
const { releaseProductImageMorph, claimProductImageMorphWithin } = vi.hoisted(() => ({
  releaseProductImageMorph: vi.fn(),
  claimProductImageMorphWithin: vi.fn(),
}));
vi.mock('./productImageMorph', () => ({
  releaseProductImageMorph,
  claimProductImageMorphWithin,
  beginProductImageMorph: vi.fn(),
  estimateDetailHeroRect: vi.fn(() => null),
}));
const { restoreProductsScroll, clearProductsScroll } = vi.hoisted(() => ({
  restoreProductsScroll: vi.fn(),
  clearProductsScroll: vi.fn(),
}));
vi.mock('./productsScroll', () => ({
  restoreProductsScroll,
  clearProductsScroll,
  saveProductsScroll: vi.fn(),
}));

// The page reads filters from the URL and writes them back via navigate.
const routerState = vi.hoisted(() => ({ search: {} as Record<string, unknown> }));
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => routerState.search,
  useNavigate: () => navigate,
}));

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
  fetchNextPage?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  isPlaceholderData?: boolean;
};

const setProducts = (state: State) => {
  const refetch = state.refetch ?? vi.fn();
  const fetchNextPage = state.fetchNextPage ?? vi.fn();
  useProducts.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    refetch,
    fetchNextPage,
    hasNextPage: state.hasNextPage ?? false,
    isFetchingNextPage: state.isFetchingNextPage ?? false,
    isPlaceholderData: state.isPlaceholderData ?? false,
  });
  return { refetch, fetchNextPage };
};

const withProducts = (products: Product[], total = products.length) => ({
  data: {
    products,
    pagination: { page: 1, pageSize: 24, total, totalPages: Math.max(1, Math.ceil(total / 24)) },
  },
});

const renderPage = () => {
  let motion: PanelPageMotion | null = null;
  const register = (value: PanelPageMotion | null): void => {
    if (value) motion = value;
  };
  const panelNavigate = vi.fn();
  const nav: PanelNav = { navigateTo: panelNavigate, pending: null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PanelNavContext.Provider value={nav}>
      <PanelPageTransitionContext.Provider value={register}>{children}</PanelPageTransitionContext.Provider>
    </PanelNavContext.Provider>
  );
  const utils = render(<ProductsPage />, { wrapper });
  return { ...utils, panelNavigate, registeredMotion: () => motion };
};

const K = 'modules.panel.products';
const addName = `${K}.add`;
const cardName = `${K}.card.viewDetails`;

beforeEach(() => {
  vi.clearAllMocks();
  routerState.search = {};
  useHasRole.mockReturnValue(false); // default: non-admin
});
afterEach(() => vi.restoreAllMocks());

describe('ProductsPage', () => {
  it('shows the staggered skeleton grid while the first page loads', () => {
    setProducts({ data: undefined, isLoading: true, isFetching: true });
    renderPage();

    expect(screen.getByRole('status', { name: `${K}.loading` })).toBeInTheDocument();
    // A returning morph clone has nothing to land on over skeletons — dismissed immediately, and
    // the saved grid position belongs to a list we no longer have — forgotten.
    expect(releaseProductImageMorph).toHaveBeenCalled();
    expect(clearProductsScroll).toHaveBeenCalled();
    expect(claimProductImageMorphWithin).not.toHaveBeenCalled();
    // The header row + filter bar are on screen from the FIRST frame (they need no data), so the
    // grid never jumps down to make room for them later.
    expect(screen.getByText(`${K}.lead`)).toBeInTheDocument();
    expect(screen.getByTestId('filterbar-apply')).toBeInTheDocument();
    // No real cards, and no add button for a (default) non-admin.
    expect(screen.queryByRole('button', { name: new RegExp(cardName) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: addName })).not.toBeInTheDocument();
  });

  it('renders the populated grid with the header lead (no add button for a non-admin)', () => {
    setProducts(withProducts([product(1, 'Mesa redonda'), product(2, 'Silla Tiffany')]));
    renderPage();

    // A WARM arrival restores the saved scroll BEFORE the returning clone measures its card.
    expect(restoreProductsScroll).toHaveBeenCalled();
    expect(claimProductImageMorphWithin).toHaveBeenCalled();
    expect(
      restoreProductsScroll.mock.invocationCallOrder[0]! <
        claimProductImageMorphWithin.mock.invocationCallOrder[0]!,
    ).toBe(true);
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
    const { panelNavigate } = renderPage();

    const add = screen.getByRole('button', { name: addName });
    await userEvent.click(add);
    expect(panelNavigate).toHaveBeenCalledWith('/panel/productos/nuevo');
  });

  it('commits filter changes to the URL (replace honoured, panel transition bypassed)', async () => {
    setProducts(withProducts([product(1, 'Mesa redonda')]));
    renderPage();

    await userEvent.click(screen.getByTestId('filterbar-apply'));
    expect(navigate).toHaveBeenCalledWith({ search: { q: 'mesa' }, replace: true, viewTransition: false });
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

  it('keeps the chrome on a FILTERED empty result and clears the filters from its panel', async () => {
    routerState.search = { q: 'zzz' };
    setProducts(withProducts([]));
    renderPage();

    // Not the "start your catalog" panel — the filters simply matched nothing.
    expect(screen.getByRole('heading', { name: `${K}.filteredEmpty.title` })).toBeInTheDocument();
    expect(screen.getByText(`${K}.lead`)).toBeInTheDocument();
    expect(screen.getByTestId('filterbar-apply')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${K}.filteredEmpty.clear` }));
    expect(navigate).toHaveBeenCalledWith({ search: {}, replace: false, viewTransition: false });
  });

  it('shows the cold-error state and retries via refetch', async () => {
    const { refetch } = setProducts({ data: undefined, isError: true, isFetching: false });
    renderPage();

    expect(screen.getByRole('heading', { name: `${K}.error.title` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${K}.error.retry` }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('stands the cold error alone even when filters are active (chrome swept out)', async () => {
    routerState.search = { q: 'mesa' };
    setProducts({ data: undefined, isLoading: true, isFetching: true });
    const { rerender } = renderPage();
    expect(screen.getByText(`${K}.lead`)).toBeInTheDocument();

    setProducts({ data: undefined, isError: true });
    rerender(<ProductsPage />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: `${K}.error.title` })).toBeInTheDocument(),
    );
    expect(screen.queryByText(`${K}.lead`)).not.toBeInTheDocument();
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

  it('sweeps the grid skeletons out to the FILTERED empty panel, keeping the chrome', async () => {
    routerState.search = { categoria: 3 };
    setProducts({ data: undefined, isLoading: true, isFetching: true });
    const { rerender } = renderPage();

    setProducts(withProducts([]));
    rerender(<ProductsPage />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: `${K}.filteredEmpty.title` })).toBeInTheDocument(),
    );
    expect(screen.getByText(`${K}.lead`)).toBeInTheDocument();
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

  it('shows a batch of append skeletons while the next page loads, then their cards', async () => {
    const many = Array.from({ length: 24 }, (_, i) => product(i + 1, `Producto ${i + 1}`));
    setProducts({ ...withProducts(many, 30), hasNextPage: true, isFetchingNextPage: true, isFetching: true });
    const { rerender } = renderPage();

    // Exactly the remaining 6 slots shimmer (never more than a page), swept in as a batch.
    expect(document.querySelectorAll('.append-skel')).toHaveLength(6);
    expect(screen.getAllByRole('button', { name: new RegExp(cardName) })).toHaveLength(24);

    const all = Array.from({ length: 30 }, (_, i) => product(i + 1, `Producto ${i + 1}`));
    setProducts(withProducts(all, 30));
    rerender(<ProductsPage />);

    // The landed page's cards crossfade into the SAME slots (instant under reduced motion).
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: new RegExp(cardName) })).toHaveLength(30),
    );
    expect(document.querySelectorAll('.append-skel')).toHaveLength(0);
  });

  it('fetches the next page when the sentinel intersects', () => {
    const instances: { callback: IntersectionObserverCallback; disconnected: boolean }[] = [];
    const real = window.IntersectionObserver;
    window.IntersectionObserver = class {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds: readonly number[] = [];
      constructor(callback: IntersectionObserverCallback) {
        instances.push({ callback, disconnected: false });
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    } as unknown as typeof IntersectionObserver;

    try {
      const many = Array.from({ length: 24 }, (_, i) => product(i + 1, `Producto ${i + 1}`));
      const { fetchNextPage } = setProducts({ ...withProducts(many, 30), hasNextPage: true });
      renderPage();

      const last = instances[instances.length - 1]!;
      last.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      expect(fetchNextPage).toHaveBeenCalledTimes(1);
    } finally {
      window.IntersectionObserver = real;
    }
  });

  it('offers an inline retry when the NEXT page fails (grid intact, no error panel)', async () => {
    const many = Array.from({ length: 24 }, (_, i) => product(i + 1, `Producto ${i + 1}`));
    const { fetchNextPage } = setProducts({ ...withProducts(many, 30), hasNextPage: true, isError: true });
    renderPage();

    expect(screen.queryByRole('heading', { name: `${K}.error.title` })).not.toBeInTheDocument();
    expect(screen.getByText(`${K}.nextPage.error`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${K}.nextPage.retry` }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('shows the running count (partial while more remains, plain total once complete)', () => {
    const many = Array.from({ length: 24 }, (_, i) => product(i + 1, `Producto ${i + 1}`));
    setProducts({ ...withProducts(many, 30), hasNextPage: true });
    const { rerender } = renderPage();
    expect(screen.getByText(`${K}.count.partial`)).toBeInTheDocument();

    const all = Array.from({ length: 30 }, (_, i) => product(i + 1, `Producto ${i + 1}`));
    setProducts(withProducts(all, 30));
    rerender(<ProductsPage />);
    expect(screen.getByText(`${K}.count.all`)).toBeInTheDocument();
  });

  it('dims the current grid while a filter change loads over it (keepPreviousData)', () => {
    setProducts({
      ...withProducts([product(1, 'Mesa redonda')]),
      isPlaceholderData: true,
      isFetching: true,
    });
    renderPage();

    // The stale grid stays interactive but visibly dimmed; the cards never flash to skeletons.
    expect(document.querySelector('.opacity-60')).not.toBeNull();
    expect(screen.getAllByText('Mesa redonda').length).toBeGreaterThan(0);
  });

  it('swaps a settled grid for the filtered-empty panel (and back) without a skeleton phase', async () => {
    routerState.search = { q: 'mesa' };
    setProducts(withProducts([product(1, 'Mesa redonda')]));
    const { rerender } = renderPage();
    expect(screen.getAllByText('Mesa redonda').length).toBeGreaterThan(0);

    // The narrowed filter matches nothing — the body swaps to the no-results panel in place.
    routerState.search = { q: 'mesaz' };
    setProducts(withProducts([]));
    rerender(<ProductsPage />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: `${K}.filteredEmpty.title` })).toBeInTheDocument(),
    );
    expect(screen.getByText(`${K}.lead`)).toBeInTheDocument();

    // Loosening the filter brings the grid straight back.
    routerState.search = { q: 'mesa' };
    setProducts(withProducts([product(1, 'Mesa redonda')]));
    rerender(<ProductsPage />);
    expect(screen.getAllByText('Mesa redonda').length).toBeGreaterThan(0);
  });

  it('stays calm when a filter change resolves empty over an already-empty result', async () => {
    routerState.search = { q: 'zzz' };
    setProducts(withProducts([]));
    const { rerender } = renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: `${K}.filteredEmpty.title` })).toBeInTheDocument(),
    );

    // Narrow the filter further: the placeholder rides over the same empty panel, then resolves
    // empty again — no re-stagger target changes, the panel simply remains.
    routerState.search = { q: 'zzzz' };
    setProducts({ ...withProducts([]), isPlaceholderData: true, isFetching: true });
    rerender(<ProductsPage />);
    setProducts(withProducts([]));
    rerender(<ProductsPage />);
    expect(screen.getByRole('heading', { name: `${K}.filteredEmpty.title` })).toBeInTheDocument();
  });

  it('falls back to a full page of append skeletons when the total is unknown', () => {
    const many = Array.from({ length: 24 }, (_, i) => product(i + 1, `Producto ${i + 1}`));
    setProducts({
      data: { products: many, pagination: undefined },
      hasNextPage: true,
      isFetchingNextPage: true,
      isFetching: true,
    });
    renderPage();
    expect(document.querySelectorAll('.append-skel')).toHaveLength(24);
  });

  it('re-staggers the fresh results when a filter change resolves', async () => {
    setProducts({
      ...withProducts([product(1, 'Mesa redonda')]),
      isPlaceholderData: true,
      isFetching: true,
    });
    const { rerender } = renderPage();

    setProducts(withProducts([product(9, 'Silla plegable')]));
    rerender(<ProductsPage />);

    await waitFor(() => expect(screen.getAllByText('Silla plegable').length).toBeGreaterThan(0));
    expect(document.querySelector('.opacity-60')).toBeNull();
  });

  it('registers a motion pair whose exit resolves and whose enter replays the reveal', async () => {
    setProducts(withProducts([product(1, 'Mesa redonda')]));
    const { registeredMotion } = renderPage();
    // Reduced motion (the global setup) short-circuits both: the exit resolves, the enter snaps.
    await expect(registeredMotion()!.exit()).resolves.toBeUndefined();
    expect(() => registeredMotion()!.enter({ fromCurrent: true })).not.toThrow();
  });
});
