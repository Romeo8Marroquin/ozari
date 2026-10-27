import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useProductArrangement } = vi.hoisted(() => ({ useProductArrangement: vi.fn() }));
vi.mock('./useProductArrangement', () => ({ useProductArrangement }));

const save = vi.hoisted(() => ({ saveArrangement: vi.fn(), isPending: false }));
vi.mock('./useSaveProductArrangement', () => ({ useSaveProductArrangement: () => save }));

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify }));

// The drag hook has its own suite — capture what the page hands it, so its `moveImage` can be
// driven directly, and let a test mark a tile as "in hand".
const drag = vi.hoisted(() => ({
  options: null as null | { disabled: boolean; images: { id: string }[]; moveImage: (id: string, to: number) => void },
  draggingId: null as string | null,
}));
vi.mock('./useGalleryDrag', () => ({
  useGalleryDrag: (options: typeof drag.options) => {
    drag.options = options;
    return { draggingId: drag.draggingId, getThumbHandlers: () => ({}) };
  },
}));

const motion = vi.hoisted(() => ({
  captureGalleryLayout: vi.fn(() => ({ captured: true })),
  animateGalleryLayout: vi.fn(),
}));
vi.mock('../pageMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pageMotion')>()),
  ...motion,
}));

import { QueryKeys } from '@constants/QueryKeys';
import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import { PanelPageTransitionContext, type PanelPageMotion } from '../PanelPageTransitionContext';
import ProductArrangePage from './ProductArrangePage';
import type { ProductArrangementItem } from './product.types';

const K = 'modules.panel.products.arrange';

const item = (id: number, name: string, extra: Partial<ProductArrangementItem> = {}): ProductArrangementItem => ({
  id,
  name,
  category: 'Mesas',
  businessType: 'Alquiler',
  imageUrl: `https://assets.test/${id}.webp`,
  placed: true,
  ...extra,
});

const catalog = [item(1, 'Mesa'), item(2, 'Silla'), item(3, 'Mantel')];

type State = {
  data?: ProductArrangementItem[];
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  refetch?: () => Promise<unknown>;
};

const setArrangement = (state: State) => {
  const refetch = state.refetch ?? vi.fn(() => Promise.resolve());
  useProductArrangement.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    refetch,
  });
  return refetch;
};

const renderPage = () => {
  let motionPair: PanelPageMotion | null = null;
  const register = (value: PanelPageMotion | null): void => {
    if (value) motionPair = value;
  };
  const navigate = vi.fn();
  const nav: PanelNav = { navigateTo: navigate, pending: null };
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PanelNavContext.Provider value={nav}>
        <PanelPageTransitionContext.Provider value={register}>{children}</PanelPageTransitionContext.Provider>
      </PanelNavContext.Provider>
    </QueryClientProvider>
  );
  const utils = render(<ProductArrangePage />, { wrapper });
  return { ...utils, navigate, client, invalidate, registeredMotion: () => motionPair };
};

/** The tile names in on-screen order (a tile's first paragraph is the product name). */
const tileOrder = (): string[] =>
  screen.getAllByRole('listitem').map((el) => el.querySelector('p')?.textContent ?? '');

/** The tile at `position` (1-based), asserting it is the product named. */
const tile = (name: string, position: number): HTMLElement => {
  const el = screen.getAllByRole('listitem')[position - 1]!;
  expect(el.querySelector('p')?.textContent).toBe(name);
  return el;
};

const submit = () => screen.getByRole('button', { name: `${K}.actions.submit` });
const discardButton = () => screen.getByRole('button', { name: `${K}.actions.discard` });

const httpError = (status: number, message?: string) =>
  new AxiosError('failed', String(status), undefined, undefined, {
    status,
    data: message ? { message } : {},
  } as AxiosResponse);

beforeEach(() => {
  vi.clearAllMocks();
  save.isPending = false;
  drag.options = null;
  drag.draggingId = null;
});

describe('ProductArrangePage — states', () => {
  it('shows the grid-shaped skeleton on a cold load', () => {
    setArrangement({ isLoading: true, isFetching: true });
    renderPage();
    expect(screen.getByRole('status', { name: `${K}.loading` })).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('maps a failed read to the retry panel', async () => {
    const refetch = setArrangement({ isError: true });
    renderPage();
    expect(screen.getByRole('heading', { name: `${K}.error.title` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${K}.error.retry`) }));
    expect(refetch).toHaveBeenCalled();
  });

  it('an empty catalog has nothing to arrange — it says so and leads back', async () => {
    setArrangement({ data: [] });
    const { navigate } = renderPage();
    expect(screen.getByRole('heading', { name: `${K}.empty.title` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${K}.actions.submit` })).not.toBeInTheDocument();
    // The panel's own action (the header's back link is the first of the two).
    await userEvent.click(screen.getAllByRole('button', { name: new RegExp(`${K}.back`) })[1]!);
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('renders every product as a tile in the server order, with its position', () => {
    setArrangement({ data: [item(1, 'Mesa'), item(2, 'Silla', { imageUrl: undefined })] });
    renderPage();
    const tiles = screen.getAllByRole('listitem');
    expect(tiles).toHaveLength(2);
    expect(within(tiles[0]!).getByText('1')).toBeInTheDocument();
    expect(within(tiles[0]!).getByText('Mesa')).toBeInTheDocument();
    expect(within(tiles[1]!).getByText('2')).toBeInTheDocument();
    // A photo-less product still gets its frame (an icon, no broken <img>).
    expect(tiles[1]!.querySelector('img')).toBeNull();
    expect(tiles[0]!.querySelector('img')).not.toBeNull();
    expect(screen.queryByText(`${K}.newBadge`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.unplacedNote`)).not.toBeInTheDocument();
  });

  it('the back link returns to the catalog', async () => {
    setArrangement({ data: catalog });
    const { navigate } = renderPage();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${K}.back`) }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('marks the tile in hand while it is being dragged', () => {
    drag.draggingId = '2';
    setArrangement({ data: catalog });
    renderPage();
    expect(screen.getAllByRole('listitem')[1]!.className).toContain('cursor-grabbing');
    expect(screen.getAllByRole('listitem')[0]!.className).not.toContain('cursor-grabbing');
  });

  it('a long-press picks the tile up — it never opens the browser context menu', () => {
    setArrangement({ data: catalog });
    renderPage();
    // fireEvent returns false when the handler called preventDefault.
    expect(fireEvent.contextMenu(tile('Mesa', 1))).toBe(false);
  });

  it('registers its page motion pair with the layout', async () => {
    setArrangement({ data: catalog });
    const { registeredMotion } = renderPage();
    const pair = registeredMotion();
    expect(pair).not.toBeNull();
    await pair?.exit();
    pair?.enter({ fromCurrent: true });
  });
});

describe('ProductArrangePage — arranging', () => {
  it('a clean, fully-placed catalog has nothing to save or discard', () => {
    setArrangement({ data: catalog });
    renderPage();
    expect(submit()).toBeDisabled();
    expect(discardButton()).toBeDisabled();
    fireEvent.submit(submit().closest('form')!);
    expect(save.saveArrangement).not.toHaveBeenCalled();
  });

  it('offers saving with NO move while new products are unplaced (saving places them)', () => {
    setArrangement({ data: [item(9, 'Carpa', { placed: false }), ...catalog] });
    renderPage();
    expect(screen.getByText(`${K}.newBadge`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.unplacedNote`)).toBeInTheDocument();
    expect(submit()).toBeEnabled();
    expect(discardButton()).toBeDisabled();
  });

  it('drags (via the shared drag hook), then discards back to the server order', async () => {
    setArrangement({ data: catalog });
    renderPage();
    expect(drag.options?.images.map((image) => image.id)).toEqual(['1', '2', '3']);

    act(() => drag.options?.moveImage('3', 0));
    expect(tileOrder()).toEqual(['Mantel', 'Mesa', 'Silla']);
    expect(submit()).toBeEnabled();
    // A drag animates itself; the page's own FLIP is for button/keyboard moves only.
    expect(motion.animateGalleryLayout).not.toHaveBeenCalled();

    await userEvent.click(discardButton());
    expect(tileOrder()).toEqual(['Mesa', 'Silla', 'Mantel']);
    expect(submit()).toBeDisabled();
  });

  it('the tile arrows move one step, FLIPped, and announce the new position', async () => {
    setArrangement({ data: catalog });
    renderPage();
    const first = screen.getAllByRole('listitem')[0]!;
    expect(within(first).getByRole('button', { name: `${K}.actions.earlier` })).toBeDisabled();

    await userEvent.click(within(first).getByRole('button', { name: `${K}.actions.later` }));
    expect(tileOrder()).toEqual(['Silla', 'Mesa', 'Mantel']);
    expect(motion.captureGalleryLayout).toHaveBeenCalled();
    expect(motion.animateGalleryLayout).toHaveBeenCalledWith(expect.any(HTMLElement), { captured: true });
    expect(screen.getByText(`${K}.announce`)).toBeInTheDocument();

    const last = screen.getAllByRole('listitem')[2]!;
    expect(within(last).getByRole('button', { name: `${K}.actions.later` })).toBeDisabled();
    await userEvent.click(within(last).getByRole('button', { name: `${K}.actions.earlier` }));
    expect(tileOrder()).toEqual(['Silla', 'Mantel', 'Mesa']);
  });

  it('the keyboard moves the focused tile and keeps the focus on it', () => {
    setArrangement({ data: catalog });
    renderPage();
    const mesa = tile('Mesa', 1);
    mesa.focus();

    fireEvent.keyDown(mesa, { key: 'End' });
    expect(tileOrder()).toEqual(['Silla', 'Mantel', 'Mesa']);
    expect(document.activeElement).toBe(tile('Mesa', 3));

    fireEvent.keyDown(tile('Mesa', 3), { key: 'ArrowUp' });
    expect(tileOrder()).toEqual(['Silla', 'Mesa', 'Mantel']);

    // Not a move: another key, an edge, or a key pressed on a control INSIDE the tile.
    fireEvent.keyDown(tile('Mesa', 2), { key: 'Enter' });
    fireEvent.keyDown(tile('Silla', 1), { key: 'Home' });
    fireEvent.keyDown(within(tile('Mesa', 2)).getByRole('button', { name: `${K}.actions.later` }), {
      key: 'ArrowRight',
    });
    expect(tileOrder()).toEqual(['Silla', 'Mesa', 'Mantel']);
  });

  it('freezes every move while saving', () => {
    save.isPending = true;
    setArrangement({ data: catalog });
    renderPage();
    expect(drag.options?.disabled).toBe(true);
    fireEvent.keyDown(tile('Mesa', 1), { key: 'ArrowRight' });
    expect(tileOrder()).toEqual(['Mesa', 'Silla', 'Mantel']);
    expect(within(tile('Mesa', 1)).getByRole('button', { name: `${K}.actions.later` })).toBeDisabled();
  });

  it('keeps the draft through a refetch: vanished products drop, new ones lead', () => {
    setArrangement({ data: catalog });
    const { rerender } = renderPage();
    act(() => drag.options?.moveImage('3', 0));
    expect(tileOrder()).toEqual(['Mantel', 'Mesa', 'Silla']);

    setArrangement({ data: [item(9, 'Carpa', { placed: false }), item(1, 'Mesa'), item(3, 'Mantel')] });
    rerender(<ProductArrangePage />);
    expect(tileOrder()).toEqual(['Carpa', 'Mantel', 'Mesa']);
  });
});

describe('ProductArrangePage — saving', () => {
  const arrangeAndSave = async () => {
    await userEvent.click(within(tile('Mesa', 1)).getByRole('button', { name: `${K}.actions.later` }));
    await userEvent.click(submit());
  };

  it('saves the FULL order, seeds the arrangement cache, refreshes the grid and goes back', async () => {
    setArrangement({ data: catalog });
    const saved = [item(2, 'Silla'), item(1, 'Mesa'), item(3, 'Mantel')];
    save.saveArrangement.mockImplementation((_ids, { onSuccess }) =>
      onSuccess({ data: { data: { products: saved } } }),
    );
    const { navigate, client, invalidate } = renderPage();

    await arrangeAndSave();

    expect(save.saveArrangement).toHaveBeenCalledWith([2, 1, 3], expect.any(Object));
    expect(client.getQueryData([QueryKeys.PRODUCT_ARRANGEMENT])).toEqual(saved);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [QueryKeys.PRODUCTS] });
    expect(notify.success).toHaveBeenCalledWith(`${K}.successToast`, { title: `${K}.successTitle` });
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('tolerates a success envelope without data (the list still refreshes)', async () => {
    setArrangement({ data: catalog });
    save.saveArrangement.mockImplementation((_ids, { onSuccess }) => onSuccess({ data: {} }));
    const { client, invalidate } = renderPage();

    await arrangeAndSave();

    expect(client.getQueryData([QueryKeys.PRODUCT_ARRANGEMENT])).toBeUndefined();
    expect(invalidate).toHaveBeenCalled();
  });

  it('a 409 (the catalog changed meanwhile) lands inline and offers to reload it', async () => {
    let resolveRefetch: () => void = () => {};
    const refetch = vi.fn(() => new Promise<void>((resolve) => (resolveRefetch = resolve)));
    setArrangement({ data: catalog, refetch });
    save.saveArrangement.mockImplementation((_ids, { onError }) =>
      onError(httpError(409, 'El catálogo cambió')),
    );
    renderPage();

    await arrangeAndSave();

    expect(screen.getByText('El catálogo cambió')).toBeInTheDocument();
    expect(notify.error).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: `${K}.actions.discard` })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${K}.actions.reload`) }));
    expect(refetch).toHaveBeenCalled();
    await act(async () => resolveRefetch());
    expect(screen.getByRole('button', { name: `${K}.actions.discard` })).toBeInTheDocument();
    expect(tileOrder()).toEqual(['Mesa', 'Silla', 'Mantel']);
  });

  it('a 400 lands inline without the reload action; an ambient failure toasts', async () => {
    setArrangement({ data: catalog });
    save.saveArrangement.mockImplementationOnce((_ids, { onError }) => onError(httpError(400)));
    renderPage();

    await arrangeAndSave();
    expect(screen.getByText(`${K}.errors.submitFallback`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(`${K}.actions.reload`) })).not.toBeInTheDocument();

    save.saveArrangement.mockImplementationOnce((_ids, { onError }) => onError(new Error('boom')));
    await userEvent.click(submit());
    expect(notify.error).toHaveBeenCalled();
  });

  it('never double-submits while a save is in flight', () => {
    save.isPending = true;
    setArrangement({ data: [item(9, 'Carpa', { placed: false })] });
    renderPage();
    fireEvent.submit(submit().closest('form')!);
    expect(save.saveArrangement).not.toHaveBeenCalled();
  });
});
