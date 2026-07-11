import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useProductCatalog } = vi.hoisted(() => ({ useProductCatalog: vi.fn() }));
vi.mock('./useProductCatalog', () => ({ useProductCatalog }));

const { createProduct, pending } = vi.hoisted(() => ({
  createProduct: vi.fn(),
  pending: { value: false },
}));
vi.mock('./useCreateProduct', () => ({
  useCreateProduct: () => ({ createProduct, isPending: pending.value }),
}));

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@components/notifications/notify', () => ({ notify }));

import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import ProductForm from './ProductForm';
import { BUSINESS_TYPE_SELL, createProductDefaultValues } from './SchemaCreateProduct';

const KEY = 'modules.panel.products.create';

const catalog = {
  businessTypes: [
    { id: 1, name: 'Alquiler' },
    { id: 2, name: 'Venta' },
  ],
  categories: [
    { id: 1, name: 'Mesas' },
    { id: 2, name: 'Sillas' },
  ],
  currencies: [{ id: 1, name: 'Quetzal Guatemalteco', iso4217Code: 'GTQ', symbol: 'Q' }],
  detailTypes: [
    { id: 1, name: 'Color' },
    { id: 2, name: 'Material' },
  ],
  rentTimeUnits: [
    { id: 1, name: 'Hora' },
    { id: 2, name: 'Día' },
  ],
};

type CatalogState = {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  refetch?: () => void;
};

const setCatalog = (state: CatalogState): (() => void) => {
  const refetch = state.refetch ?? vi.fn();
  useProductCatalog.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    refetch,
  });
  return refetch;
};

/** A complete, VALID Alquiler draft — seeding it lets submit-path tests skip form filling. */
const seedValidDraft = (): void => {
  Storage.set(StorageKeys.PRODUCT_CREATE_DRAFT, {
    ...createProductDefaultValues,
    name: 'Mesa redonda',
    description: 'Mesa para 8 personas',
    categoryId: 1,
    quantity: '40',
    rentPrice: '75',
    replacementPrice: '900',
    details: [{ detailTypeId: 1, detail: 'Blanco nieve' }],
  });
};

const axiosError = (status: number, message?: string) => ({
  isAxiosError: true,
  response: { status, data: message ? { message } : {} },
});

const renderForm = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const navigate = vi.fn();
  const nav: PanelNav = { navigateTo: navigate, pending: null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PanelNavContext.Provider value={nav}>{children}</PanelNavContext.Provider>
    </QueryClientProvider>
  );
  const utils = render(<ProductForm />, { wrapper });
  return { ...utils, navigate, invalidate };
};

type MutateHandlers = { onSuccess: () => void; onError: (error: unknown) => void };
const lastHandlers = (): MutateHandlers =>
  createProduct.mock.calls[createProduct.mock.calls.length - 1]?.[1] as MutateHandlers;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  pending.value = false;
  setCatalog({ data: catalog });
});

describe('ProductForm — reference data states', () => {
  it('shows skeleton section shells while the catalog loads', () => {
    setCatalog({ data: undefined, isLoading: true });
    renderForm();
    expect(screen.getByRole('status', { name: `${KEY}.loading` })).toBeInTheDocument();
  });

  it('shows an honest retry panel on a cold catalog failure', async () => {
    const refetch = setCatalog({ data: undefined, isError: true });
    renderForm();
    expect(screen.getByRole('heading', { name: `${KEY}.catalogError.title` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.catalogError.retry` }));
    expect(refetch).toHaveBeenCalled();
  });

  it('treats an empty payload like a failure (the form never renders empty selects)', () => {
    setCatalog({ data: null });
    renderForm();
    expect(screen.getByRole('heading', { name: `${KEY}.catalogError.title` })).toBeInTheDocument();
  });
});

describe('ProductForm — conditional pricing UI', () => {
  it('opens on Alquiler (rent price + time unit) and swaps to Venta, clearing the rent fields', async () => {
    renderForm();
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.rentPriceLabel`))).toBeInTheDocument();
    expect(screen.queryByLabelText(new RegExp(`${KEY}.fields.sellPriceLabel`))).not.toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText(new RegExp(`${KEY}.fields.businessTypeLabel`)),
      String(BUSINESS_TYPE_SELL),
    );

    expect(await screen.findByLabelText(new RegExp(`${KEY}.fields.sellPriceLabel`))).toBeInTheDocument();
    expect(screen.queryByLabelText(new RegExp(`${KEY}.fields.rentPriceLabel`))).not.toBeInTheDocument();

    // Switching back re-arms the rent side with pristine values (nothing stale survives).
    await userEvent.selectOptions(
      screen.getByLabelText(new RegExp(`${KEY}.fields.businessTypeLabel`)),
      '1',
    );
    const rentPrice = await screen.findByLabelText(new RegExp(`${KEY}.fields.rentPriceLabel`));
    expect(rentPrice).toHaveValue(null); // an empty number input
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.rentTimeUnitLabel`))).toHaveValue('2');
  });
});

describe('ProductForm — details sub-editor', () => {
  it('adds and removes detail rows', async () => {
    renderForm();
    expect(screen.queryByLabelText(new RegExp(`${KEY}.fields.detailTypeLabel`))).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.addDetail` }));
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.detailTypeLabel`))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.removeDetail` }));
    expect(screen.queryByLabelText(new RegExp(`${KEY}.fields.detailTypeLabel`))).not.toBeInTheDocument();
  });
});

describe('ProductForm — silent draft', () => {
  it('autosaves as the user types and clears when back at pristine', async () => {
    renderForm();
    const name = screen.getByLabelText(new RegExp(`${KEY}.fields.nameLabel`));
    await userEvent.type(name, 'Mesa');
    await waitFor(() =>
      expect(
        Storage.get<{ name: string }>(StorageKeys.PRODUCT_CREATE_DRAFT)?.name,
      ).toBe('Mesa'),
    );

    await userEvent.clear(name);
    await waitFor(() => expect(Storage.get(StorageKeys.PRODUCT_CREATE_DRAFT)).toBeNull());
  });

  it('restores a stored draft with a visible note, and discards it on demand', async () => {
    seedValidDraft();
    renderForm();

    expect(screen.getByText(`${KEY}.draft.restored`)).toBeInTheDocument();
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.nameLabel`))).toHaveValue('Mesa redonda');

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.draft.discard` }));
    expect(screen.queryByText(`${KEY}.draft.restored`)).not.toBeInTheDocument();
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.nameLabel`))).toHaveValue('');
    await waitFor(() => expect(Storage.get(StorageKeys.PRODUCT_CREATE_DRAFT)).toBeNull());
  });
});

describe('ProductForm — submit', () => {
  it('maps the form to the API body; success clears the draft, refreshes the list, toasts, and returns', async () => {
    seedValidDraft();
    const { navigate, invalidate } = renderForm();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createProduct).toHaveBeenCalled());

    expect(createProduct.mock.calls[0]?.[0]).toMatchObject({
      name: 'Mesa redonda',
      businessTypeId: 1,
      categoryId: 1,
      quantity: 40,
      rentPrice: 75,
      rentTimeUnitId: 2,
      replacementPrice: 900,
      productDetails: [{ detailTypeId: 1, detail: 'Blanco nieve' }],
    });

    act(() => lastHandlers().onSuccess());
    expect(Storage.get(StorageKeys.PRODUCT_CREATE_DRAFT)).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [QueryKeys.PRODUCTS] });
    expect(notify.success).toHaveBeenCalledWith(`${KEY}.successToast`, { title: `${KEY}.successTitle` });
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('surfaces backend validation INLINE in the form banner (400)', async () => {
    seedValidDraft();
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createProduct).toHaveBeenCalled());

    act(() => lastHandlers().onError(axiosError(400, 'precio inválido')));
    expect(await screen.findByText('precio inválido')).toBeInTheDocument();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('sends ambient failures to a toast (500)', async () => {
    seedValidDraft();
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createProduct).toHaveBeenCalled());

    act(() => lastHandlers().onError(axiosError(500)));
    expect(notify.error).toHaveBeenCalled();
  });

  it('stays silent on an outage (the app overlay owns backend-down)', async () => {
    seedValidDraft();
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createProduct).toHaveBeenCalled());

    act(() => lastHandlers().onError(axiosError(503)));
    expect(notify.error).not.toHaveBeenCalled();
    // The form banner stays collapsed and empty (every field also renders its own quiet alert slot,
    // so the assertion targets the banner element specifically).
    expect(document.getElementById('create-product-error')?.textContent).toBe('');
  });

  it('ignores a submit while a request is already in flight', async () => {
    seedValidDraft();
    pending.value = true;
    renderForm();
    // Submit the FORM directly (the button is in its loading state) — the guard must still hold.
    fireEvent.submit(document.getElementById('create-product-form') as HTMLFormElement);
    await waitFor(() => expect(createProduct).not.toHaveBeenCalled());
  });

  it('cancel returns to the catalog, keeping the draft for a later visit', async () => {
    seedValidDraft();
    const { navigate } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.cancel` }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
    expect(Storage.get(StorageKeys.PRODUCT_CREATE_DRAFT)).not.toBeNull();
  });
});
