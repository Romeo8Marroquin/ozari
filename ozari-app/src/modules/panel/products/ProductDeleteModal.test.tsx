import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Control the mutation: capture the { onSuccess, onError } handlers the modal passes to `mutate`.
const { deleteProduct, useDeleteProduct } = vi.hoisted(() => ({
  deleteProduct: vi.fn(),
  useDeleteProduct: vi.fn(),
}));
vi.mock('./useDeleteProduct', () => ({ useDeleteProduct }));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

import { QueryKeys } from '@constants/QueryKeys';
import ProductDeleteModal from './ProductDeleteModal';
import type { Product } from './product.types';

const KEY = 'modules.panel.products.detail.deleteModal';

const product: Product = {
  id: 7,
  name: 'Mesa redonda',
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Mesas',
  categoryId: 1,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  images: [],
  details: [],
};

type Handlers = { onSuccess: () => void; onError: (failure: unknown) => void };

const renderModal = (open = true, onClose = vi.fn()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const onDeleted = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const utils = render(
    <ProductDeleteModal open={open} onClose={onClose} product={product} onDeleted={onDeleted} />,
    { wrapper },
  );
  return { ...utils, invalidate, onDeleted, onClose };
};

/** Confirm the deletion; returns the captured mutation handlers. */
const confirmDelete = async (): Promise<Handlers> => {
  await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
  await waitFor(() => expect(deleteProduct).toHaveBeenCalled());
  return deleteProduct.mock.calls[0][1] as Handlers;
};

const axiosError = (status: number, message?: string) => ({
  isAxiosError: true,
  response: { status, data: message ? { message } : {} },
});

beforeEach(() => {
  vi.clearAllMocks();
  useDeleteProduct.mockReturnValue({ deleteProduct, isPending: false });
});

describe('ProductDeleteModal', () => {
  it('renders nothing meaningful when closed', () => {
    renderModal(false);
    expect(screen.queryByText(`${KEY}.title`)).not.toBeInTheDocument();
  });

  it('states the irreversible consequence and offers a real cancel', async () => {
    const { onClose } = renderModal();
    expect(screen.getByRole('note')).toHaveTextContent(`${KEY}.warning`);

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.cancel` }));
    expect(onClose).toHaveBeenCalled();
    expect(deleteProduct).not.toHaveBeenCalled();
  });

  it('on success: closes, toasts, marks caches stale WITHOUT refetching the dying page, hands off the exit', async () => {
    const { invalidate, onDeleted, onClose } = renderModal();
    const handlers = await confirmDelete();
    expect(deleteProduct).toHaveBeenCalledWith(7, expect.any(Object));

    act(() => handlers.onSuccess());
    expect(onClose).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(`${KEY}.successToast`, { title: `${KEY}.successTitle` });
    // The grid refetches in the background; the detail entry goes stale but is NOT refetched now —
    // the page is still rendering it under the exit (a refetch here was the old 404+loader flash).
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [QueryKeys.PRODUCTS] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [QueryKeys.PRODUCT, 7],
      refetchType: 'none',
    });
    expect(onDeleted).toHaveBeenCalled();
  });

  it('treats a 404 exactly like success — the product is already gone, the goal is met', async () => {
    const { onDeleted } = renderModal();
    const handlers = await confirmDelete();

    act(() => handlers.onError(axiosError(404, 'no existe')));
    expect(onDeleted).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('lands an inline-class failure (409) in the dialog banner, no toast, no departure', async () => {
    const { onDeleted } = renderModal();
    const handlers = await confirmDelete();

    act(() => handlers.onError(axiosError(409, 'conflicto')));
    expect(await screen.findByText('conflicto')).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('sends ambient failures (500) to a toast and outages to silence', async () => {
    renderModal();
    const handlers = await confirmDelete();

    act(() => handlers.onError(axiosError(500)));
    expect(error).toHaveBeenCalled();

    error.mockClear();
    act(() => handlers.onError(axiosError(503)));
    expect(error).not.toHaveBeenCalled(); // the app overlay owns backend-down
  });

  it('locks the dialog while the request is in flight (both buttons disabled)', () => {
    useDeleteProduct.mockReturnValue({ deleteProduct, isPending: true });
    renderModal();
    expect(screen.getByRole('button', { name: `${KEY}.confirm` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `${KEY}.cancel` })).toBeDisabled();
  });

  it('clears a stale error banner when reopened', async () => {
    const { rerender } = renderModal();
    const handlers = await confirmDelete();
    act(() => handlers.onError(axiosError(409, 'conflicto')));
    expect(await screen.findByText('conflicto')).toBeInTheDocument();

    rerender(
      <ProductDeleteModal open={false} onClose={vi.fn()} product={product} onDeleted={vi.fn()} />,
    );
    rerender(<ProductDeleteModal open onClose={vi.fn()} product={product} onDeleted={vi.fn()} />);
    const banner = document.getElementById('product-delete-error')?.closest('[aria-hidden]');
    expect(banner).toHaveAttribute('aria-hidden', 'true');
  });
});
