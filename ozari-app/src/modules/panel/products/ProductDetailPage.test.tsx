import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The query drives every state — mock it to pin loading / data / not-found / error.
const { useProduct } = vi.hoisted(() => ({ useProduct: vi.fn() }));
vi.mock('./useProduct', () => ({ useProduct }));

// Role drives the action row (useRole) and the Admin gate (useHasRole).
const { useRole, useHasRole } = vi.hoisted(() => ({ useRole: vi.fn(), useHasRole: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useRole, useHasRole }));

// The page reads its id from the route params.
const routeParams = vi.hoisted(() => ({ productId: '7' }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => routeParams }));

// The page registers a history-departure HOLD (browser/device back choreography) — capture it.
const departure = vi.hoisted(() => ({
  hold: null as null | ((nextPathname: string) => Promise<void> | null),
  cleared: [] as unknown[],
}));
vi.mock('@utils/historyDeparture', () => ({
  setHistoryDepartureHold: (hold: (nextPathname: string) => Promise<void> | null) => {
    departure.hold = hold;
  },
  clearHistoryDepartureHold: (hold: unknown) => {
    departure.cleared.push(hold);
  },
}));

// The shared-element morph: the page's CLAIM/BEGIN decisions are what these tests pin.
const { beginProductImageMorph, claimProductImageMorph, releaseProductImageMorph, hasProductImageMorphInFlight } =
  vi.hoisted(() => ({
    beginProductImageMorph: vi.fn(),
    claimProductImageMorph: vi.fn(),
    releaseProductImageMorph: vi.fn(),
    hasProductImageMorphInFlight: vi.fn(),
  }));
vi.mock('./productImageMorph', () => ({
  beginProductImageMorph,
  claimProductImageMorph,
  releaseProductImageMorph,
  hasProductImageMorphInFlight,
}));
const { scrollPanelToTop } = vi.hoisted(() => ({ scrollPanelToTop: vi.fn() }));
vi.mock('./productsScroll', () => ({ scrollPanelToTop }));

// The full-size viewer has its own suite — a stub captures the wiring.
const lightbox = vi.hoisted(() => ({
  props: null as null | { initialIndex: number; label: string; onClose: () => void },
}));
vi.mock('@components/ImageLightbox', () => ({
  default: (props: { initialIndex: number; label: string; onClose: () => void }) => {
    lightbox.props = props;
    return <div data-testid="lightbox-stub" />;
  },
}));

// The delete confirmation has its own suite — a stub captures the open/close/deleted wiring.
type DeleteModalProps = {
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
  product: { id: number };
};
const deleteModal = vi.hoisted(() => ({ props: null as null | DeleteModalProps }));
vi.mock('./ProductDeleteModal', () => ({
  default: (props: DeleteModalProps) => {
    deleteModal.props = props;
    return <div data-testid="delete-modal-stub" data-open={props.open} />;
  },
}));

import { Role } from '@constants/Roles';
import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import { PanelPageTransitionContext, type PanelPageMotion } from '../PanelPageTransitionContext';
import ProductDetailPage from './ProductDetailPage';
import type { Product } from './product.types';

const K = 'modules.panel.products';
const D = `${K}.detail`;

const base: Product = {
  id: 7,
  name: 'Mesa redonda',
  description: 'Mesa para 8 personas',
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Mesas',
  categoryId: 1,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 75,
  rentTimeUnit: 'Día',
  images: [
    { id: 1, url: 'https://cdn/a.webp', isPrimary: true, sortOrder: 0 },
    { id: 2, url: 'https://cdn/b.webp', isPrimary: false, sortOrder: 1 },
  ],
  details: [{ id: 12, detail: 'Blanco', detailType: 'Color', detailTypeId: 1 }],
};

type State = {
  data?: Product | null;
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  refetch?: () => void;
  error?: unknown;
};

const setProduct = (state: State) => {
  const refetch = state.refetch ?? vi.fn();
  useProduct.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    refetch,
    error: state.error,
  });
  return refetch;
};

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
  const utils = render(<ProductDetailPage />, { wrapper });
  return { ...utils, navigate, registeredMotion: () => motion };
};

beforeEach(() => {
  vi.clearAllMocks();
  routeParams.productId = '7';
  useRole.mockReturnValue(Role.Client);
  useHasRole.mockReturnValue(false);
  claimProductImageMorph.mockReturnValue(false);
  hasProductImageMorphInFlight.mockReturnValue(false);
  window.history.replaceState({}, '', '/panel/productos/7');
});
afterEach(() => vi.restoreAllMocks());

describe('ProductDetailPage', () => {
  it('shows the skeleton on a cold load and RELEASES any in-flight morph clone', () => {
    setProduct({ data: undefined, isLoading: true, isFetching: true });
    renderPage();
    expect(screen.getByRole('status', { name: `${D}.loading` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${D}.back` })).toBeInTheDocument();
    // No hero exists to claim the clone — it must never float over the skeleton.
    expect(releaseProductImageMorph).toHaveBeenCalled();
    expect(claimProductImageMorph).not.toHaveBeenCalled();
  });

  it('renders the product (chips, name, price, stock count, description, details) and claims the morph', () => {
    setProduct({ data: { ...base, available: 40, inStock: true } });
    renderPage();

    expect(screen.getByText('Mesas')).toBeInTheDocument();
    expect(screen.getByText('Alquiler')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mesa redonda' })).toBeInTheDocument();
    expect(screen.getByText('Q75 / Día')).toBeInTheDocument();
    expect(screen.getByText(`${K}.stock.count`)).toBeInTheDocument();
    expect(screen.getByText('Mesa para 8 personas')).toBeInTheDocument();
    expect(screen.getByText('Color:')).toBeInTheDocument();
    expect(screen.getByText('Blanco')).toBeInTheDocument();

    // A new page always opens at the top (the shared scroller carried the grid's position).
    expect(scrollPanelToTop).toHaveBeenCalled();
    // The hero carries the shared "animation id" and the page tried to claim the clone for it.
    const hero = document.querySelector('[data-morph-id="7"]')!;
    expect(claimProductImageMorph).toHaveBeenCalledWith(7, hero, hero, expect.any(Function));
    // No morph in flight (mock returned false) → the hero joins the normal entrance stagger.
    expect(hero.classList.contains('reveal-item')).toBe(true);
  });

  it('pulls the hero OUT of the entrance stagger while a claimed morph owns its reveal, then restores it on settle', () => {
    claimProductImageMorph.mockReturnValue(true);
    setProduct({ data: base });
    renderPage();

    const hero = document.querySelector('[data-morph-id="7"]')!;
    expect(hero.classList.contains('reveal-item')).toBe(false);
    // The module fires onSettled when the clone lands (or on ANY interruption) — the hero then
    // rejoins the page's motion vocabulary (exits sweep it).
    const onSettled = claimProductImageMorph.mock.calls[0]![3] as () => void;
    onSettled();
    expect(hero.classList.contains('reveal-item')).toBe(true);
  });

  it('switches the hero image via a CROSSFADE (ghost of the outgoing image, then it drops)', async () => {
    setProduct({ data: base });
    renderPage();

    const thumbs = screen.getAllByRole('button', { name: `${D}.thumbAlt` });
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]).toHaveAttribute('aria-current', 'true');

    await userEvent.click(thumbs[1]!);
    expect(thumbs[1]).toHaveAttribute('aria-current', 'true');
    expect(thumbs[0]).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('product-hero-image')).toHaveAttribute('src', 'https://cdn/b.webp');
    // The outgoing image ghosts UNDER the incoming one, then unmounts when the fade settles
    // (instant under reduced motion).
    await waitFor(() =>
      expect(document.querySelectorAll('[data-morph-id="7"] img')).toHaveLength(1),
    );

    // Re-clicking the ACTIVE thumbnail is a no-op — no ghost, no fade.
    await userEvent.click(thumbs[1]!);
    expect(document.querySelectorAll('[data-morph-id="7"] img')).toHaveLength(1);
  });

  it('frames the hero in the grid card’s 3:4 and shows the WHOLE photo — the skeleton wears the same frame', () => {
    setProduct({ data: undefined, isLoading: true, isFetching: true });
    const { rerender } = renderPage();
    // The cold-load placeholder is the real frame, so nothing jumps when the data lands.
    expect(document.querySelector('[role="status"] .aspect-\\[3\\/4\\]')).not.toBeNull();

    setProduct({ data: base });
    rerender(<ProductDetailPage />);
    const frame = document.querySelector<HTMLElement>('[data-morph-id="7"]')!;
    expect(frame.className).toContain('aspect-[3/4]');
    // Never cropped: contained (letterboxed on the frame's white), never covered.
    const hero = screen.getByTestId('product-hero-image');
    expect(hero.className).toContain('object-contain');
    expect(hero.className).not.toContain('object-cover');
    // The frame and its thumbnails share ONE capped, centred column (fits the viewport at lg).
    expect(frame.parentElement!.className).toContain('max-w-[max(14rem,calc((100svh_-_12rem)*0.75))]');
  });

  it('keeps the share control MOUNTED through the skeleton (row sized, inert) and fades it in with the data', () => {
    setProduct({ data: undefined, isLoading: true, isFetching: true });
    const { rerender } = renderPage();

    // Present from first paint so the row never reflows (a late mount tilted the whole column),
    // but invisible AND inert — nothing focusable/clickable shares a nameless product.
    const shareWrap = document.querySelector(
      'button[aria-label="components.share.label"]',
    )!.parentElement!;
    expect(shareWrap).toHaveAttribute('aria-hidden', 'true');
    expect(shareWrap).toHaveAttribute('inert');
    expect(shareWrap.className).toContain('opacity-0');

    // The data lands → the same element fades visible (CSS transition — binary state).
    setProduct({ data: base });
    rerender(<ProductDetailPage />);
    expect(shareWrap).toHaveAttribute('aria-hidden', 'false');
    expect(shareWrap).not.toHaveAttribute('inert');
    expect(shareWrap.className).toContain('opacity-100');
  });

  it('OPENS on the FLAGGED primary wherever it sits — the gallery order stays untouched', async () => {
    // The star lives on the LAST slot: the page must open there (hero + aria-current), while the
    // thumbnails keep the admin's display order (never reordered around the star).
    setProduct({
      data: {
        ...base,
        images: [
          { id: 1, url: 'https://cdn/a.webp', isPrimary: false, sortOrder: 0 },
          { id: 2, url: 'https://cdn/b.webp', isPrimary: false, sortOrder: 1 },
          { id: 3, url: 'https://cdn/c.webp', isPrimary: true, sortOrder: 2 },
        ],
      },
    });
    renderPage();

    expect(screen.getByTestId('product-hero-image')).toHaveAttribute('src', 'https://cdn/c.webp');
    const thumbs = screen.getAllByRole('button', { name: `${D}.thumbAlt` });
    expect(thumbs[2]).toHaveAttribute('aria-current', 'true');
    expect(thumbs[0]).not.toHaveAttribute('aria-current');

    // An explicit pick still works from there.
    await userEvent.click(thumbs[0]!);
    expect(screen.getByTestId('product-hero-image')).toHaveAttribute('src', 'https://cdn/a.webp');
  });

  it('opens the lightbox from the hero at the CURRENT image, and closes it back', async () => {
    setProduct({ data: base });
    renderPage();

    // Switch to the second image first — the viewer must open exactly there.
    await userEvent.click(screen.getAllByRole('button', { name: `${D}.thumbAlt` })[1]!);
    await userEvent.click(screen.getByRole('button', { name: `${D}.lightbox.open` }));

    expect(screen.getByTestId('lightbox-stub')).toBeInTheDocument();
    expect(lightbox.props).toMatchObject({ initialIndex: 1, label: 'Mesa redonda' });

    act(() => lightbox.props!.onClose());
    expect(screen.queryByTestId('lightbox-stub')).not.toBeInTheDocument();
  });

  it('plays the hero crossfade as a REAL tween when motion is allowed', async () => {
    const realMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false, // motion allowed
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      setProduct({ data: base });
      renderPage();
      // The page ENTRANCE also runs for real now — wait for the thumbs to become visible.
      const thumbs = await screen.findAllByRole('button', { name: `${D}.thumbAlt` }, { timeout: 3000 });
      await userEvent.click(thumbs[1]!);
      // Two layers exist while the 0.22s crossfade runs; the ghost drops when it settles.
      expect(document.querySelectorAll('[data-morph-id="7"] img').length).toBeGreaterThan(1);
      await waitFor(
        () => expect(document.querySelectorAll('[data-morph-id="7"] img')).toHaveLength(1),
        { timeout: 2000 },
      );
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it('falls back to the first image when the active index outlives a shrunken gallery', async () => {
    setProduct({ data: base });
    const { rerender } = renderPage();
    await userEvent.click(screen.getAllByRole('button', { name: `${D}.thumbAlt` })[1]!);

    setProduct({ data: { ...base, images: [base.images[0]!] } });
    rerender(<ProductDetailPage />);
    expect(screen.getByTestId('product-hero-image')).toHaveAttribute('src', 'https://cdn/a.webp');
  });

  it('shows the brand mark (no thumbnails, no price line) for a bare product', () => {
    setProduct({
      data: { ...base, images: [], rentPrice: undefined, rentTimeUnit: undefined, description: undefined },
    });
    const { container } = renderPage();
    expect(screen.queryByRole('button', { name: `${D}.thumbAlt` })).not.toBeInTheDocument();
    expect(screen.queryByText(/Q\d/)).not.toBeInTheDocument();
    expect(screen.getByText(`${K}.card.noDescription`)).toBeInTheDocument();
    expect(container.querySelector('[data-morph-id="7"] svg')).toBeInTheDocument();
  });

  it('maps the role CTA: Client sees Rentar (Alquiler) / Comprar (Venta); an Admin sees NO consumer CTA', () => {
    setProduct({ data: base });
    const { rerender } = renderPage();
    expect(screen.getByRole('button', { name: new RegExp(`${K}.card.actions.rent`) })).toBeInTheDocument();

    setProduct({ data: { ...base, businessType: 'Venta', rentPrice: undefined, sellPrice: 900 } });
    rerender(<ProductDetailPage />);
    expect(screen.getByRole('button', { name: new RegExp(`${K}.card.actions.buy`) })).toBeInTheDocument();

    // "Ordenar" is gone (Epic-2A): the admin's order-on-behalf flow is a dedicated form in the
    // orders epic, so a non-Client role gets no consumer CTA here at all.
    useRole.mockReturnValue(Role.Admin);
    rerender(<ProductDetailPage />);
    expect(screen.queryByRole('button', { name: new RegExp(`${K}.card.actions.buy`) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(`${K}.card.actions.rent`) })).not.toBeInTheDocument();
  });

  it('offers Editar + Eliminar to an Admin (management verbs live HERE, not on the card)', () => {
    useRole.mockReturnValue(Role.Admin);
    useHasRole.mockReturnValue(true);
    setProduct({ data: base });
    renderPage();
    expect(screen.getByRole('button', { name: new RegExp(`${D}.actions.edit`) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(`${D}.actions.delete`) })).toBeInTheDocument();
  });

  it('Eliminar opens the delete confirmation (never deletes directly), and it closes back', async () => {
    useRole.mockReturnValue(Role.Admin);
    useHasRole.mockReturnValue(true);
    setProduct({ data: base });
    renderPage();

    expect(deleteModal.props).toMatchObject({ open: false, product: { id: 7 } });
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${D}.actions.delete`) }));
    expect(deleteModal.props).toMatchObject({ open: true });

    act(() => deleteModal.props?.onClose());
    expect(deleteModal.props).toMatchObject({ open: false });
  });

  it('after a deletion, leaves to the grid with a PLAIN fade — the morph never lifts off', () => {
    useRole.mockReturnValue(Role.Admin);
    useHasRole.mockReturnValue(true);
    setProduct({ data: base });
    const { navigate, unmount } = renderPage();

    // The modal reports the deletion; the PAGE owns the departure.
    act(() => deleteModal.props?.onDeleted());
    expect(navigate).toHaveBeenCalledWith('/panel/productos');

    // A browser-back racing the delete departure must decline the hold the same way (no lift).
    expect(departure.hold?.('/panel/productos')).toBeNull();
    expect(beginProductImageMorph).not.toHaveBeenCalled();

    // Unmounting while headed to the grid would normally lift the hero toward its card — but the
    // card no longer exists, so the lift must stand down (plain page fade instead).
    window.history.replaceState({}, '', '/panel/productos');
    hasProductImageMorphInFlight.mockReturnValue(false);
    unmount();
    expect(beginProductImageMorph).not.toHaveBeenCalled();
  });

  it('flips to the not-found panel when a background refetch discovers the product is GONE', () => {
    // Cached data + a 404 error = deleted elsewhere while on screen — never keep the ghost.
    setProduct({ data: base, isError: true, error: { response: { status: 404 } } });
    renderPage();
    expect(screen.getByRole('heading', { name: `${D}.notFound.title` })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Mesa redonda' })).not.toBeInTheDocument();
  });

  it('Editar navigates to the product edit page through the panel transition', async () => {
    useRole.mockReturnValue(Role.Admin);
    useHasRole.mockReturnValue(true);
    setProduct({ data: base });
    const { navigate } = renderPage();

    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${D}.actions.edit`) }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos/7/editar');
  });

  it('shows the replacement price ONLY when the projection sent it (Admin) — by field presence', () => {
    setProduct({ data: { ...base, replacementPrice: 900 } });
    const { rerender } = renderPage();
    expect(screen.getByText(`${D}.replacementPrice`, { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Q900')).toBeInTheDocument();

    setProduct({ data: base }); // Client projection — the field never arrives
    rerender(<ProductDetailPage />);
    expect(screen.queryByText(`${D}.replacementPrice`, { exact: false })).not.toBeInTheDocument();
  });

  it('shows the security deposit per unit whenever the product carries one (every role)', () => {
    setProduct({ data: { ...base, securityDeposit: 150 } });
    const { rerender } = renderPage();
    expect(screen.getByText(`${D}.securityDeposit:`)).toBeInTheDocument();
    expect(screen.getByText(`· ${D}.securityDepositNote`)).toBeInTheDocument();

    setProduct({ data: base }); // no deposit configured — nothing rendered
    rerender(<ProductDetailPage />);
    expect(screen.queryByText(`${D}.securityDeposit:`)).not.toBeInTheDocument();
  });

  it('shows availability variants: zero wording by type, fleet view, bare signal, Client nothing', () => {
    // The base fixture is Alquiler — a fully-booked fleet is "No disponible", never "Agotado".
    setProduct({ data: { ...base, available: 0, inStock: false } });
    const { rerender } = renderPage();
    expect(screen.getByText(`${K}.stock.unavailable`)).toBeInTheDocument();

    // A sold-out VENTA product IS "Agotado" (gone until the business restocks).
    setProduct({ data: { ...base, businessType: 'Venta', available: 0, inStock: false } });
    rerender(<ProductDetailPage />);
    expect(screen.getByText(`${K}.stock.out`)).toBeInTheDocument();

    // Admin + Alquiler: available AND the fleet total — the "X de Y disponibles" view.
    setProduct({ data: { ...base, available: 35, total: 40, inStock: true } });
    rerender(<ProductDetailPage />);
    expect(screen.getByText(`${K}.stock.countOfTotal`)).toBeInTheDocument();

    setProduct({ data: { ...base, inStock: true } });
    rerender(<ProductDetailPage />);
    expect(screen.getByText(`${K}.stock.available`)).toBeInTheDocument();

    setProduct({ data: { ...base, inStock: false } });
    rerender(<ProductDetailPage />);
    expect(screen.getByText(`${K}.stock.unavailable`)).toBeInTheDocument();

    setProduct({ data: base });
    rerender(<ProductDetailPage />);
    expect(screen.queryByText(`${K}.stock.available`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.stock.out`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.stock.unavailable`)).not.toBeInTheDocument();
  });

  it('shows the NOT-FOUND panel for a 404 with a way back', async () => {
    setProduct({ data: undefined, isError: true, error: { response: { status: 404 } } });
    const { navigate } = renderPage();
    expect(screen.getByRole('heading', { name: `${D}.notFound.title` })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${D}.notFound.back` }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('shows the error panel for a transient failure and retries via refetch', async () => {
    const refetch = setProduct({ data: undefined, isError: true, error: new Error('boom') });
    renderPage();
    expect(screen.getByRole('heading', { name: `${D}.error.title` })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${D}.error.retry` }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('navigates back through the panel transition, lifting the hero off for the REVERSE morph', async () => {
    setProduct({ data: base });
    const { navigate } = renderPage();
    await userEvent.click(screen.getByRole('button', { name: `${D}.back` }));
    // The hero photo is the reverse morph's source (its card claims the clone on the grid).
    expect(beginProductImageMorph).toHaveBeenCalledWith(
      7,
      document.querySelector('[data-morph-id="7"] img'),
    );
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('holds a HISTORY back to the grid: lift-off + exit choreography, then the commit proceeds', async () => {
    setProduct({ data: base });
    renderPage();
    const heroImg = document.querySelector('[data-morph-id="7"] img');

    // The device/browser back headed to the grid: the hold lifts the hero off and resolves once
    // the exit finishes (instant under the suite's reduced motion).
    const pending = departure.hold!('/panel/productos');
    expect(pending).not.toBeNull();
    await expect(pending).resolves.toBeUndefined();
    expect(beginProductImageMorph).toHaveBeenCalledWith(7, heroImg);
  });

  it('declines history moves not headed to the grid — the router handles them untouched', () => {
    setProduct({ data: base });
    renderPage();
    expect(departure.hold!('/panel/ajustes')).toBeNull();
    expect(beginProductImageMorph).not.toHaveBeenCalled();
  });

  it('declines when a morph is already in flight (a back racing the in-app lift-off)', () => {
    // NOTE: this guard is a race-condition nicety only. The interceptor's own re-dispatched event
    // never reaches the hold anymore (utils/historyDeparture marks and skips it) — relying on this
    // check for that was the blank-page-after-chained-backs bug.
    setProduct({ data: base });
    renderPage();
    hasProductImageMorphInFlight.mockReturnValue(true);
    expect(departure.hold!('/panel/productos')).toBeNull();
    expect(beginProductImageMorph).not.toHaveBeenCalled();
  });

  it('clears its OWN hold on unmount (identity-checked — never a successor’s)', () => {
    setProduct({ data: base });
    const { unmount } = renderPage();
    const registered = departure.hold;
    unmount();
    expect(departure.cleared).toContain(registered);
  });

  it('lifts the hero off on a BROWSER-BACK unmount headed to the grid (no morph in flight yet)', () => {
    setProduct({ data: base });
    const { unmount } = renderPage();
    const heroImg = document.querySelector('[data-morph-id="7"] img');

    // Browser back: the URL flips first, THEN the page unmounts — the cleanup sees the grid.
    window.history.replaceState({}, '', '/panel/productos');
    unmount();
    expect(beginProductImageMorph).toHaveBeenCalledWith(7, heroImg);
  });

  it('never double-begins when the in-app back already lifted off (morph in flight)', () => {
    setProduct({ data: base });
    const { unmount } = renderPage();

    hasProductImageMorphInFlight.mockReturnValue(true);
    window.history.replaceState({}, '', '/panel/productos');
    unmount();
    expect(beginProductImageMorph).not.toHaveBeenCalled();
  });

  it('leaves any OTHER departure untouched (another tab, logout — not the grid)', () => {
    setProduct({ data: base });
    const { unmount } = renderPage();

    window.history.replaceState({}, '', '/panel/ajustes');
    unmount();
    expect(beginProductImageMorph).not.toHaveBeenCalled();
  });

  it('registers a motion pair whose exit resolves and whose enter replays the reveal', async () => {
    setProduct({ data: base });
    const { registeredMotion } = renderPage();
    await expect(registeredMotion()!.exit()).resolves.toBeUndefined();
    expect(() => registeredMotion()!.enter({ fromCurrent: true })).not.toThrow();
  });
});

describe('ProductDetailPage — variations', () => {
  const photo = (id: number, name: string) => ({
    id,
    url: `https://cdn/${name}.webp`,
    isPrimary: true,
    sortOrder: 0,
  });
  const withVariations: Product = {
    ...base,
    options: [
      {
        id: 1,
        name: 'Color',
        sortOrder: 0,
        values: [
          { id: 1, name: 'Rojo', sortOrder: 0, images: [photo(31, 'rojo')] },
          { id: 2, name: 'Azul', sortOrder: 1, images: [] },
        ],
      },
      {
        id: 2,
        name: 'Tamaño',
        sortOrder: 1,
        values: [
          { id: 3, name: 'Redondo', sortOrder: 0, images: [photo(32, 'redondo')] },
          { id: 4, name: 'Cuadrado', sortOrder: 1, images: [] },
        ],
      },
    ],
    variants: [
      {
        id: 10,
        valueIds: [1, 3],
        label: 'Rojo · Redondo',
        isDefault: true,
        rentPrice: 90,
        securityDeposit: 0,
        replacementPrice: 400,
        description: 'Mantel rojo para mesa redonda',
        available: 3,
        total: 5,
        inStock: true,
      },
      { id: 11, valueIds: [2, 3], label: 'Azul · Redondo', isDefault: false, rentPrice: 60 },
    ],
  };
  const chip = (name: string) => screen.getByRole('button', { name });
  const hero = () => screen.queryByTestId('product-hero-image');

  it('opens on the showcase, priced "Desde" its lowest variation, asking for the picks', () => {
    setProduct({ data: withVariations });
    renderPage();
    expect(hero()).toHaveAttribute('src', 'https://cdn/a.webp');
    expect(screen.getByText(`${K}.card.priceFrom`)).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: `${D}.options` })).toHaveLength(2);
    expect(screen.getByText(`${D}.pickHint`)).toBeInTheDocument();
  });

  it("a pick shows that value's photos; picking it again goes back to the showcase", async () => {
    setProduct({ data: withVariations });
    renderPage();
    await userEvent.click(chip('Rojo'));
    expect(chip('Rojo')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(hero()).toHaveAttribute('src', 'https://cdn/rojo.webp'));

    // Azul has no photos of its own (and nothing else is picked) → the showcase.
    await userEvent.click(chip('Azul'));
    await waitFor(() => expect(hero()).toHaveAttribute('src', 'https://cdn/a.webp'));
    // Un-picking Azul keeps the same set — nothing to crossfade.
    await userEvent.click(chip('Azul'));
    expect(chip('Azul')).toHaveAttribute('aria-pressed', 'false');
    expect(hero()).toHaveAttribute('src', 'https://cdn/a.webp');
  });

  it('a complete pick speaks for THAT variation: price, deposit, replacement, stock, description', async () => {
    useRole.mockReturnValue(Role.Admin);
    setProduct({ data: { ...withVariations, available: 9, total: 12, replacementPrice: 500 } });
    renderPage();
    await userEvent.click(chip('Rojo'));
    await userEvent.click(chip('Redondo'));

    expect(screen.getByText('Rojo · Redondo')).toBeInTheDocument();
    expect(screen.getByText('Q90 / Día')).toBeInTheDocument();
    // A deposit override of 0 is the variation's own value — never the product's.
    expect(screen.getByText('Q0')).toBeInTheDocument();
    expect(screen.getByText('Q400')).toBeInTheDocument();
    expect(screen.getByText(`${K}.stock.countOfTotal`)).toBeInTheDocument();
    expect(screen.getByText('Mantel rojo para mesa redonda')).toBeInTheDocument();
  });

  it('says a combination is not offered, and mutes the values that lead nowhere', async () => {
    setProduct({ data: withVariations });
    renderPage();
    await userEvent.click(chip('Rojo'));
    expect(chip('Cuadrado').className).toContain('opacity-45');
    expect(chip('Redondo').className).not.toContain('opacity-45');
    await userEvent.click(chip('Cuadrado'));
    expect(screen.getByText(`${D}.notOffered`)).toBeInTheDocument();
  });

  it("opens without a showcase on the default variation's photos (the grid's cover)", async () => {
    setProduct({ data: { ...withVariations, images: [] } });
    renderPage();
    expect(hero()).toHaveAttribute('src', 'https://cdn/rojo.webp');
    // Azul alone has no photos and there is no showcase → the brand mark (no ghost left behind).
    await userEvent.click(chip('Azul'));
    expect(hero()).not.toBeInTheDocument();
  });
});
