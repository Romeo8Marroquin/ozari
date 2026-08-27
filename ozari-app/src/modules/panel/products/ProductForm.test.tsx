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

const { updateProduct, updatePending } = vi.hoisted(() => ({
  updateProduct: vi.fn(),
  updatePending: { value: false },
}));
vi.mock('./useUpdateProduct', () => ({
  useUpdateProduct: () => ({ updateProduct, isPending: updatePending.value }),
}));

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@components/notifications/notify', () => ({ notify }));

// Only the draft SWITCH is stubbed; the rest of the preferences module stays real.
const { formDrafts } = vi.hoisted(() => ({
  formDrafts: vi.fn(() => ({ enabled: true, isLoading: false })),
}));
vi.mock('../preferences/usePreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../preferences/usePreferences')>()),
  useFormDraftsEnabled: formDrafts,
}));

// The upload hook is mocked (its own test covers the presign + PUT mechanics); the REAL
// useGalleryImages runs underneath so these tests exercise the actual staging behaviour.
const { uploadImages, uploading } = vi.hoisted(() => ({
  uploadImages: vi.fn(),
  uploading: { value: false },
}));
vi.mock('./useProductImageUploads', () => ({
  useProductImageUploads: () => ({
    uploadImages,
    isUploading: uploading.value,
    progress: {},
  }),
}));

import { QueryKeys } from '@constants/QueryKeys';
import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import ProductForm from './ProductForm';
import type { Product } from './product.types';
import { BUSINESS_TYPE_SELL, createProductDefaultValues } from './SchemaCreateProduct';

const KEY = 'modules.panel.products.create';
/** The draft note is ONE component shared by both create forms, so its copy is not per-form. */
const DRAFT_KEY = 'modules.panel.formDraft';

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

const renderForm = (props: { mode?: 'create' | 'edit'; product?: Product } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const setData = vi.spyOn(client, 'setQueryData');
  const navigate = vi.fn();
  const nav: PanelNav = { navigateTo: navigate, pending: null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PanelNavContext.Provider value={nav}>{children}</PanelNavContext.Provider>
    </QueryClientProvider>
  );
  const utils = render(<ProductForm {...props} />, { wrapper });
  return { ...utils, navigate, invalidate, setData };
};

type MutateHandlers = { onSuccess: () => void; onError: (error: unknown) => void };
const lastHandlers = (): MutateHandlers =>
  createProduct.mock.calls[createProduct.mock.calls.length - 1]?.[1] as MutateHandlers;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  formDrafts.mockReturnValue({ enabled: true, isLoading: false });
  pending.value = false;
  updatePending.value = false;
  uploading.value = false;
  uploadImages.mockResolvedValue({});
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  setCatalog({ data: catalog });
});

/** Stages one valid photo in the gallery through its (hidden) file input. */
const stagePhoto = (name = 'foto.png'): void => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['x'], name, { type: 'image/png' })] },
  });
};

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

  // A "successful" 200 with a null/empty payload (wiped/unseeded DB) is NOT a failure to retry —
  // it's a config gap (missing seeded reference data) → the preferences state, not the error panel.
  it('treats an empty payload as a config state (preferences), not a retry', async () => {
    setCatalog({ data: null });
    const { navigate } = renderForm();
    expect(screen.getByRole('heading', { name: `${KEY}.configMissing.title` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${KEY}.catalogError.retry` })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'modules.panel.dataStatus.goToPreferences' }));
    // Straight to the preferences screen, where the missing reference data is actually created.
    expect(navigate).toHaveBeenCalledWith('/panel/preferencias');
  });

  it.each([
    'businessTypes',
    'categories',
    'currencies',
    'rentTimeUnits',
    'detailTypes',
  ] as const)('treats a catalog with an empty %s list as a config state', (list) => {
    setCatalog({ data: { ...catalog, [list]: [] } });
    renderForm();
    expect(screen.getByRole('heading', { name: `${KEY}.configMissing.title` })).toBeInTheDocument();
  });

  it('SWEEPS between the form and the retry panel (and back after a successful retry)', async () => {
    const { rerender } = renderForm();
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.nameLabel`))).toBeInTheDocument();

    // The catalog turns into an error → the form sweeps out, then the panel renders.
    setCatalog({ data: undefined, isError: true });
    rerender(<ProductForm />);
    expect(
      await screen.findByRole('heading', { name: `${KEY}.catalogError.title` }),
    ).toBeInTheDocument();

    // A successful retry → the panel sweeps out and the loaded form returns.
    setCatalog({ data: catalog });
    rerender(<ProductForm />);
    expect(await screen.findByLabelText(new RegExp(`${KEY}.fields.nameLabel`))).toBeInTheDocument();
  });

  it('abandons an in-flight view sweep cleanly on unmount (no stray commit)', async () => {
    const { rerender, unmount } = renderForm();
    setCatalog({ data: undefined, isError: true });
    rerender(<ProductForm />);
    unmount(); // the pending sweep's commit must be cancelled — no setState after unmount
    await act(async () => {});
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
    await waitFor(() =>
      expect(screen.queryByLabelText(new RegExp(`${KEY}.fields.detailTypeLabel`))).not.toBeInTheDocument(),
    );
  });

  it('hides types already used by other rows and caps the add button at the type count', async () => {
    renderForm();
    const addButton = screen.getByRole('button', { name: `${KEY}.actions.addDetail` });

    // Row 1 takes "Color" → row 2's select must no longer offer it (but keeps its own choice).
    await userEvent.click(addButton);
    await userEvent.selectOptions(
      screen.getByLabelText(new RegExp(`${KEY}.fields.detailTypeLabel`)),
      '1',
    );
    await userEvent.click(addButton);

    const selects = screen.getAllByLabelText(new RegExp(`${KEY}.fields.detailTypeLabel`));
    const optionNames = (select: HTMLElement): string[] =>
      Array.from(select.querySelectorAll('option')).map((option) => option.textContent ?? '');
    expect(optionNames(selects[0])).toContain('Color');
    expect(optionNames(selects[1])).not.toContain('Color');
    expect(optionNames(selects[1])).toContain('Material');

    // The catalog has TWO detail types → with two rows the add button caps out.
    expect(addButton).toBeDisabled();
  });

  it('ignores a second remove click while the row is already animating out', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.addDetail` }));

    const trash = screen.getByRole('button', { name: `${KEY}.actions.removeDetail` });
    // Two SYNCHRONOUS clicks — the second lands while the exit tween is still pending.
    fireEvent.click(trash);
    fireEvent.click(trash);

    await waitFor(() =>
      expect(screen.queryByLabelText(new RegExp(`${KEY}.fields.detailTypeLabel`))).not.toBeInTheDocument(),
    );
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

    // The note lives in an always-mounted grid-rows collapse (so it eases, never pops); open =
    // the collapse container is not hidden.
    const noteContainer = screen.getByText(`${DRAFT_KEY}.restored`).closest('[aria-hidden]');
    expect(noteContainer).toHaveAttribute('aria-hidden', 'false');
    expect(noteContainer?.className).toContain('grid-rows-[1fr]');
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.nameLabel`))).toHaveValue('Mesa redonda');

    await userEvent.click(screen.getByRole('button', { name: `${DRAFT_KEY}.discard` }));
    // Discard COLLAPSES the note (still mounted through the animation) instead of yanking it out.
    expect(noteContainer).toHaveAttribute('aria-hidden', 'true');
    expect(noteContainer?.className).toContain('grid-rows-[0fr]');
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.nameLabel`))).toHaveValue('');
    await waitFor(() => expect(Storage.get(StorageKeys.PRODUCT_CREATE_DRAFT)).toBeNull());
  });

  it('honours its OWN switch: off means nothing restored and nothing kept', async () => {
    // `forms.saveDraftProducts`, separate from the order form's — a product is set up once at a
    // desk, an order is filled with a client on the phone, so the answer for one is not the answer
    // for the other. Off also EMPTIES the slot: it has to mean "nothing of mine is being kept".
    seedValidDraft();
    formDrafts.mockReturnValue({ enabled: false, isLoading: false });
    renderForm();

    await waitFor(() => expect(Storage.get(StorageKeys.PRODUCT_CREATE_DRAFT)).toBeNull());
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.nameLabel`))).toHaveValue('');
    expect(screen.getByText(`${DRAFT_KEY}.restored`).closest('[aria-hidden]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    await userEvent.type(screen.getByLabelText(new RegExp(`${KEY}.fields.nameLabel`)), 'Mesa');
    expect(Storage.get(StorageKeys.PRODUCT_CREATE_DRAFT)).toBeNull();
  });

  it('keeps the note collapsed (hidden and inert) when there is no draft to restore', () => {
    renderForm();
    const noteContainer = screen.getByText(`${DRAFT_KEY}.restored`).closest('[aria-hidden]');
    expect(noteContainer).toHaveAttribute('aria-hidden', 'true');
    expect(noteContainer?.className).toContain('grid-rows-[0fr]');
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

  it('uploads staged photos first and references their keys (the starred one primary)', async () => {
    seedValidDraft();
    // The upload hook resolves keys BY LOCAL IMAGE ID — mirror that contract here.
    uploadImages.mockImplementation((images: { id: string; file?: File }[]) =>
      Promise.resolve(
        Object.fromEntries(
          images.filter((img) => img.file).map((img) => [img.id, 'products/k1.png']),
        ),
      ),
    );
    renderForm();
    stagePhoto();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createProduct).toHaveBeenCalled());

    expect(uploadImages).toHaveBeenCalledWith([
      expect.objectContaining({ file: expect.objectContaining({ name: 'foto.png' }) }),
    ]);
    expect(createProduct.mock.calls[0]?.[0]).toMatchObject({
      images: [{ key: 'products/k1.png', isPrimary: true }],
    });
  });

  it('an upload failure surfaces per the form doctrine and never reaches the create call', async () => {
    seedValidDraft();
    uploadImages.mockRejectedValue(axiosError(500));
    renderForm();
    stagePhoto();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(notify.error).toHaveBeenCalled());

    expect(createProduct).not.toHaveBeenCalled();
    // The staged photo survives the failure — the user just retries the same submit.
    expect(screen.getByAltText('foto.png')).toBeInTheDocument();
  });

  it('an inline-class upload failure (400) lands in the form banner', async () => {
    seedValidDraft();
    uploadImages.mockRejectedValue(axiosError(400, 'archivo inválido'));
    renderForm();
    stagePhoto();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    expect(await screen.findByText('archivo inválido')).toBeInTheDocument();
    expect(notify.error).not.toHaveBeenCalled();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('guards re-submits while photos are uploading (button shows the uploading label)', async () => {
    seedValidDraft();
    uploading.value = true;
    renderForm();

    expect(screen.getByText(`${KEY}.actions.uploading`)).toBeInTheDocument();
    fireEvent.submit(document.getElementById('create-product-form') as HTMLFormElement);
    await waitFor(() => expect(uploadImages).not.toHaveBeenCalled());
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('cancel returns to the catalog, keeping the draft for a later visit', async () => {
    seedValidDraft();
    const { navigate } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.cancel` }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
    expect(Storage.get(StorageKeys.PRODUCT_CREATE_DRAFT)).not.toBeNull();
  });
});

describe('ProductForm — edit mode', () => {
  const EDIT_KEY = 'modules.panel.products.edit';

  /** The edit subject — an Admin-projected Alquiler product with two photos and one detail. */
  const editProduct: Product = {
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
    rentTimeUnitId: 2,
    replacementPrice: 900,
    inStock: true,
    available: 35,
    total: 40,
    isActive: true,
    images: [
      { id: 11, url: 'https://cdn/a.webp', isPrimary: true, sortOrder: 0 },
      { id: 12, url: 'https://cdn/b.webp', isPrimary: false, sortOrder: 1 },
    ],
    details: [{ id: 21, detail: 'Blanco nieve', detailType: 'Color', detailTypeId: 1 }],
  };

  const renderEdit = () => renderForm({ mode: 'edit', product: editProduct });

  type UpdateHandlers = {
    onSuccess: (response: { data: { data?: Product } }) => void;
    onError: (error: unknown) => void;
  };
  const lastUpdateHandlers = (): UpdateHandlers =>
    updateProduct.mock.calls[updateProduct.mock.calls.length - 1]?.[1] as UpdateHandlers;

  it('prefills every field from the product and seeds the gallery (star on the flagged photo)', () => {
    renderEdit();

    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.nameLabel`))).toHaveValue('Mesa redonda');
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.quantityLabel`))).toHaveValue(40);
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.rentPriceLabel`))).toHaveValue(75);
    expect(screen.getByLabelText(new RegExp(`${KEY}.fields.detailValueLabel`))).toHaveValue('Blanco nieve');

    // The gallery holds the EXISTING photos (remote previews), the flagged one starred.
    expect(screen.getByAltText('foto-1')).toHaveAttribute('src', 'https://cdn/a.webp');
    expect(screen.getByAltText('foto-2')).toHaveAttribute('src', 'https://cdn/b.webp');
    const stars = screen.getAllByRole('button', {
      name: new RegExp(`${KEY}.gallery.actions.setPrimary`),
    });
    expect(stars[0]).toHaveAttribute('aria-pressed', 'true');

    // Mode copy: the submit verb and the photos-section description are the edit ones.
    expect(screen.getByRole('button', { name: `${EDIT_KEY}.actions.submit` })).toBeInTheDocument();
    expect(screen.getByText(`${EDIT_KEY}.photosDescription`)).toBeInTheDocument();
  });

  it('never drafts: ignores a stored create draft and autosaves nothing', async () => {
    seedValidDraft();
    renderEdit();

    // The form shows the PRODUCT, and the create draft's restored note stays collapsed.
    const noteContainer = screen.getByText(`${DRAFT_KEY}.restored`).closest('[aria-hidden]');
    expect(noteContainer).toHaveAttribute('aria-hidden', 'true');

    // Typing must not touch the stored create draft (edit has no draft at all).
    await userEvent.type(screen.getByLabelText(new RegExp(`${KEY}.fields.nameLabel`)), 'X');
    await act(async () => {});
    expect(
      Storage.get<{ description: string }>(StorageKeys.PRODUCT_CREATE_DRAFT)?.description,
    ).toBe('Mesa para 8 personas');
  });

  it('submits the FULL desired state: kept photos by id in display order, new by key, details keep ids', async () => {
    uploadImages.mockImplementation((images: { id: string; file?: File }[]) =>
      Promise.resolve(
        Object.fromEntries(
          images.filter((img) => img.file).map((img) => [img.id, 'products/new.webp']),
        ),
      ),
    );
    renderEdit();
    stagePhoto('nueva.png');

    await userEvent.click(screen.getByRole('button', { name: `${EDIT_KEY}.actions.submit` }));
    await waitFor(() => expect(updateProduct).toHaveBeenCalled());

    expect(createProduct).not.toHaveBeenCalled();
    expect(updateProduct.mock.calls[0]?.[0]).toMatchObject({
      id: 7,
      body: {
        name: 'Mesa redonda',
        businessTypeId: 1,
        quantity: 40,
        rentPrice: 75,
        rentTimeUnitId: 2,
        replacementPrice: 900,
        productDetails: [{ id: 21, detailTypeId: 1, detail: 'Blanco nieve' }],
        images: [
          { id: 11, isPrimary: true },
          { id: 12, isPrimary: false },
          { key: 'products/new.webp', isPrimary: false },
        ],
      },
    });
  });

  it('success writes the 200 payload into the detail cache, refreshes the list, toasts, and returns', async () => {
    const { navigate, invalidate, setData } = renderEdit();
    await userEvent.click(screen.getByRole('button', { name: `${EDIT_KEY}.actions.submit` }));
    await waitFor(() => expect(updateProduct).toHaveBeenCalled());

    // The response body IS the authoritative post-save product — the detail page must render it
    // instantly on return (no refetch flash), while the list refreshes in the background.
    const saved = { ...editProduct, name: 'Mesa redonda XL' };
    act(() => lastUpdateHandlers().onSuccess({ data: { data: saved } }));
    expect(setData).toHaveBeenCalledWith([QueryKeys.PRODUCT, 7], saved);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [QueryKeys.PRODUCTS] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: [QueryKeys.PRODUCT, 7] });
    expect(notify.success).toHaveBeenCalledWith(`${EDIT_KEY}.successToast`, {
      title: `${EDIT_KEY}.successTitle`,
    });
    expect(navigate).toHaveBeenCalledWith('/panel/productos/7');
  });

  it('falls back to a detail refetch if a 2xx somehow arrives without the payload', async () => {
    const { invalidate, setData } = renderEdit();
    await userEvent.click(screen.getByRole('button', { name: `${EDIT_KEY}.actions.submit` }));
    await waitFor(() => expect(updateProduct).toHaveBeenCalled());

    act(() => lastUpdateHandlers().onSuccess({ data: {} }));
    expect(setData).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [QueryKeys.PRODUCT, 7] });
  });

  it('the mid-save conflict (409) lands INLINE in the banner, per the form doctrine', async () => {
    renderEdit();
    await userEvent.click(screen.getByRole('button', { name: `${EDIT_KEY}.actions.submit` }));
    await waitFor(() => expect(updateProduct).toHaveBeenCalled());

    act(() => lastUpdateHandlers().onError(axiosError(409, 'el producto cambió')));
    expect(await screen.findByText('el producto cambió')).toBeInTheDocument();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('cancel returns to the product detail (where the edit began)', async () => {
    const { navigate } = renderEdit();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.cancel` }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos/7');
  });
});
