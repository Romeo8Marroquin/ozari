import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The four data hooks + the mutation drive every state — mock them.
const { useOrdersCatalog } = vi.hoisted(() => ({ useOrdersCatalog: vi.fn() }));
const { useOrderProducts } = vi.hoisted(() => ({ useOrderProducts: vi.fn() }));
const { useClientRegistries } = vi.hoisted(() => ({ useClientRegistries: vi.fn() }));
const { createOrder, useCreateOrder } = vi.hoisted(() => ({ createOrder: vi.fn(), useCreateOrder: vi.fn() }));
vi.mock('./useOrdersCatalog', () => ({ useOrdersCatalog }));
vi.mock('./useOrderProducts', () => ({ useOrderProducts }));
vi.mock('./useClientRegistries', () => ({ useClientRegistries }));
vi.mock('./useCreateOrder', () => ({ useCreateOrder }));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

// Stub the registry modal — its own suite covers it; here we only need the create hand-off.
const { newRegistry } = vi.hoisted(() => ({
  newRegistry: {
    id: 9,
    name: 'Nuevo Cliente',
    contacts: [{ id: 1, contactType: { id: 1, name: 'WhatsApp' }, value: '4444-9999', isPrincipal: true }],
    addresses: [{ id: 1, address: 'Hacienda Real, lote 5', isFavorite: true }],
    createdAt: 'x',
  },
}));
vi.mock('./ClientRegistryModal', () => ({
  default: ({ open, onCreated, onClose }: { open: boolean; onCreated: (r: unknown) => void; onClose: () => void }) =>
    open ? (
      <>
        <button type="button" onClick={() => onCreated(newRegistry)}>
          stub-registry-create
        </button>
        <button type="button" onClick={onClose}>
          stub-registry-close
        </button>
      </>
    ) : null,
}));

import { QueryKeys } from '@constants/QueryKeys';
import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import type { Product } from '../products/product.types';
import type { ClientRegistry, OrderCatalog } from './order.types';
import OrderForm from './OrderForm';

const KEY = 'modules.panel.orders.create';

const rentalProduct: Product = {
  id: 3,
  name: 'Silla plegable',
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Sillas',
  categoryId: 2,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 6,
  rentTimeUnit: 'Día',
  rentTimeUnitId: 2,
  images: [],
  details: [],
};
const saleProduct: Product = {
  id: 4,
  name: 'Vasos',
  businessType: 'Venta',
  businessTypeId: 2,
  category: 'Accesorios',
  categoryId: 5,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  sellPrice: 3.5,
  images: [],
  details: [],
};

const registry: ClientRegistry = {
  id: 3,
  name: 'María López',
  contacts: [
    { id: 1, contactType: { id: 1, name: 'WhatsApp' }, value: '5555-1234', isPrincipal: true },
    { id: 2, contactType: { id: 2, name: 'Teléfono' }, value: '2222-3333', isPrincipal: false },
  ],
  addresses: [
    // The favorite address's zone carries a fee (autofilled); the second has no zone/fee.
    { id: 1, zone: { id: 6, name: 'Zona 10', deliveryFee: 50 }, address: 'Zona 10, 4a avenida 5-55', isFavorite: true },
    { id: 2, address: 'Hacienda Real lote 5', isFavorite: false },
  ],
  preferredPaymentMethod: { id: 1, name: 'Efectivo' },
  createdAt: 'x',
};

const catalog: OrderCatalog = {
  eventTypes: [{ id: 1, name: 'Evento familiar', minLeadHours: 24 }],
  serviceStatuses: [],
  paymentStatuses: [],
  paymentMethods: [{ id: 1, name: 'Efectivo' }, { id: 2, name: 'Transferencia' }],
  contactTypes: [{ id: 1, name: 'WhatsApp' }],
  zones: [{ id: 6, name: 'Zona 10', deliveryFee: 50 }],
};

type QueryState<T> = { data?: T; isLoading?: boolean; isError?: boolean; refetch?: () => void };
const q = <T,>(state: QueryState<T>) => ({
  data: state.data,
  isLoading: state.isLoading ?? false,
  isError: state.isError ?? false,
  isFetching: false,
  refetch: state.refetch ?? vi.fn(),
});

const setReady = () => {
  useOrdersCatalog.mockReturnValue(q({ data: catalog }));
  useOrderProducts.mockReturnValue(q({ data: [rentalProduct, saleProduct] }));
  useClientRegistries.mockReturnValue(q({ data: [registry] }));
};

const renderForm = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const setData = vi.spyOn(client, 'setQueryData');
  const navigateTo = vi.fn();
  const nav: PanelNav = { navigateTo, pending: null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PanelNavContext.Provider value={nav}>{children}</PanelNavContext.Provider>
    </QueryClientProvider>
  );
  const utils = render(<OrderForm />, { wrapper });
  return { ...utils, invalidate, setData, navigateTo };
};

const byId = (container: HTMLElement, id: string) => container.querySelector(`#${id}`) as HTMLElement;
const setDateTime = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

type Handlers = { onSuccess: () => void; onError: (e: unknown) => void };
const axiosError = (status: number, message?: string, data?: unknown) => ({
  isAxiosError: true,
  response: { status, data: { ...(message ? { message } : {}), ...(data ? { data } : {}) } },
});

/** Fill a valid single-rental order (client prefill + event + window + one line), without submit. */
const fillValid = async (container: HTMLElement): Promise<void> => {
  const user = userEvent.setup();
  await user.selectOptions(byId(container, 'order-client'), '3'); // prefills the snapshots
  await user.selectOptions(byId(container, 'order-event-type'), '1');
  setDateTime(byId(container, 'order-delivery-at'), '2026-08-01T14:00');
  await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
  await user.selectOptions(byId(container, 'order-line-product-0'), '3');
  await user.type(byId(container, 'order-line-quantity-0'), '25');
  await waitFor(() => expect(byId(container, 'order-pickup-at')).toBeInTheDocument());
  setDateTime(byId(container, 'order-pickup-at'), '2026-08-02T15:00');
};

/** Fill a valid order and submit; returns the captured mutation handlers. */
const fillAndSubmit = async (container: HTMLElement): Promise<Handlers> => {
  await fillValid(container);
  await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
  await waitFor(() => expect(createOrder).toHaveBeenCalled());
  return createOrder.mock.calls[0][1] as Handlers;
};

beforeEach(() => {
  vi.clearAllMocks();
  useCreateOrder.mockReturnValue({ createOrder, isPending: false });
  setReady();
});
afterEach(() => vi.restoreAllMocks());

describe('OrderForm', () => {
  it('shows section skeletons (real card chrome, shimmer bodies) while any query loads', () => {
    useOrderProducts.mockReturnValue(q({ isLoading: true }));
    useOrdersCatalog.mockReturnValue(q({ isLoading: true })); // catalog?. fallbacks exercised
    useClientRegistries.mockReturnValue(q({ isLoading: true })); // registries fallback exercised
    renderForm();
    // The loading state is the FORM view with the section CARD chrome (titles) real, bodies
    // shimmering — NOT the error panel and NOT the raw controls yet.
    expect(screen.getByRole('status')).toHaveAccessibleName(`${KEY}.loading`);
    expect(screen.getByText(`${KEY}.sections.mode.title`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.sections.client.title`)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument(); // body still a skeleton
    expect(screen.queryByText(`${KEY}.loadError.title`)).not.toBeInTheDocument();
  });

  it('an empty PRODUCT catalog is a friendly nudge (not an error), linking to create a product', async () => {
    const user = userEvent.setup();
    useOrderProducts.mockReturnValue(q({ data: [] })); // loaded, but nothing to order
    const { navigateTo } = renderForm();
    expect(screen.getByText(`${KEY}.emptyProducts.title`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.loadError.title`)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `${KEY}.emptyProducts.action` }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/productos/nuevo');
  });

  it('an empty REGISTRY list is NOT a blocker — the form still renders', () => {
    useClientRegistries.mockReturnValue(q({ data: [] }));
    renderForm();
    // Registries empty ⇒ the form is fully usable (create a client inline); never the error panel.
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.loadError.title`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.emptyProducts.title`)).not.toBeInTheDocument();
  });

  it('smoothly swaps the whole view when the state changes (form → error → back)', async () => {
    const { rerender } = renderForm(); // starts on the form
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();

    // A query fails on a refetch → the view sweeps out and the error panel sweeps in.
    useOrdersCatalog.mockReturnValue(q({ isError: true }));
    rerender(<OrderForm />);
    await waitFor(() => expect(screen.getByText(`${KEY}.loadError.title`)).toBeInTheDocument());
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();

    // Recovery → back to the form, same smooth swap.
    setReady();
    rerender(<OrderForm />);
    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument());
  });

  it('abandons an in-flight view sweep cleanly on unmount (no stray commit)', async () => {
    const { rerender, unmount } = renderForm();
    useOrdersCatalog.mockReturnValue(q({ isError: true }));
    rerender(<OrderForm />); // starts the sweep to the error view (staggerOut pending)
    unmount(); // the pending sweep's completion must be cancelled — no setState after unmount
    await act(async () => {});
  });

  it('shows the empty-client placeholder when there are no registries', () => {
    useClientRegistries.mockReturnValue(q({ data: [] }));
    const { container } = renderForm();
    expect(within(byId(container, 'order-client')).getByText(`${KEY}.fields.clientEmpty`)).toBeInTheDocument();
  });

  it('a REAL request failure shows the retry panel and retries all three queries', async () => {
    const refetch = vi.fn();
    useOrdersCatalog.mockReturnValue(q({ isError: true, refetch }));
    useOrderProducts.mockReturnValue(q({ data: [rentalProduct], refetch }));
    useClientRegistries.mockReturnValue(q({ data: [registry], refetch }));
    renderForm();
    expect(screen.getByText(`${KEY}.loadError.title`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.loadError.retry` }));
    expect(refetch).toHaveBeenCalled();
  });

  it('an all-success load with EMPTY reference data is a config state (preferences), not an error', async () => {
    const user = userEvent.setup();
    // Every request succeeded, but the seeded event types are missing → not a retry situation.
    useOrdersCatalog.mockReturnValue(q({ data: { ...catalog, eventTypes: [] } }));
    const { navigateTo } = renderForm();
    expect(screen.getByText(`${KEY}.configMissing.title`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.loadError.title`)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${KEY}.loadError.retry` })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'modules.panel.dataStatus.goToPreferences' }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/ajustes');
  });

  it('renders the sections with the mode fork defaulting to rent', () => {
    renderForm();
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.sections.client.title`)).toBeInTheDocument();
    // Rent mode → the product picker offers only the rental product.
    // (No line yet — verified indirectly via the mode-switch test below.)
  });

  it('the mode filter offers only matching products and switching drops incompatible lines', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    const productSelect = byId(container, 'order-line-product-0');
    // Rent mode: the option list has the rental (id 3), not the sale (id 4).
    expect(within(productSelect).queryByRole('option', { name: 'Silla plegable' })).toBeInTheDocument();
    expect(within(productSelect).queryByRole('option', { name: 'Vasos' })).not.toBeInTheDocument();

    await user.selectOptions(productSelect, '3');
    // Switch to Buy → the rental line is removed (product 3 doesn't fit).
    await user.click(screen.getByRole('radio', { name: `${KEY}.mode.buy` }));
    await waitFor(() => expect(byId(container, 'order-line-product-0')).toBeNull());
  });

  it('selecting a client prefills the delivery snapshots', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    await user.selectOptions(byId(container, 'order-client'), '3');
    await waitFor(() =>
      expect((byId(container, 'order-delivery-name') as HTMLInputElement).value).toBe('María López'),
    );
    expect((byId(container, 'order-delivery-contact') as HTMLInputElement).value).toBe('5555-1234');
  });

  it('autofills the delivery fee + preferred payment from the client and shows the saved-data pickers', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    await user.selectOptions(byId(container, 'order-client'), '3');
    await waitFor(() =>
      expect((byId(container, 'order-delivery-amount') as HTMLInputElement).value).toBe('50'),
    );
    // Preferred payment method pre-selected.
    expect((byId(container, 'order-payment-method') as HTMLSelectElement).value).toBe('1');
    // The saved-data quick-fill pickers appear (the client has contacts + addresses).
    expect(byId(container, 'order-saved-contact')).toBeInTheDocument();
    expect(byId(container, 'order-saved-address')).toBeInTheDocument();
  });

  it('the saved-data pickers fill the snapshot from another saved contact/address; a placeholder pick is a no-op', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    await user.selectOptions(byId(container, 'order-client'), '3');
    await waitFor(() =>
      expect((byId(container, 'order-delivery-contact') as HTMLInputElement).value).toBe('5555-1234'),
    );

    // Pick the second saved contact → fills the contact field.
    await user.selectOptions(byId(container, 'order-saved-contact'), '2');
    expect((byId(container, 'order-delivery-contact') as HTMLInputElement).value).toBe('2222-3333');

    // Pick the second saved address (no zone fee) → fills the address, leaves the fee untouched.
    await user.selectOptions(byId(container, 'order-saved-address'), '2');
    expect((byId(container, 'order-delivery-address') as HTMLTextAreaElement).value).toBe('Hacienda Real lote 5');
    expect((byId(container, 'order-delivery-amount') as HTMLInputElement).value).toBe('50');

    // Pick the first saved address (zone fee 50) → refills the fee.
    await user.selectOptions(byId(container, 'order-saved-address'), '1');
    expect((byId(container, 'order-delivery-amount') as HTMLInputElement).value).toBe('50');

    // Selecting the placeholder option on either picker is a no-op (nothing to fill).
    await user.selectOptions(byId(container, 'order-saved-contact'), '');
    expect((byId(container, 'order-delivery-contact') as HTMLInputElement).value).toBe('2222-3333');
    await user.selectOptions(byId(container, 'order-saved-address'), '');
    expect((byId(container, 'order-delivery-address') as HTMLTextAreaElement).value).toBe('Zona 10, 4a avenida 5-55');
  });

  it('lets the admin change the payment method, sending it on submit', async () => {
    const { container } = renderForm();
    await fillValid(container);
    await userEvent.selectOptions(byId(container, 'order-payment-method'), '2');
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createOrder).toHaveBeenCalled());
    expect(createOrder.mock.calls[0][0].paymentMethodId).toBe(2);
  });

  it('creating a client through the modal seeds the picker cache (prepending the new client) and selects it', async () => {
    const user = userEvent.setup();
    const { setData } = renderForm();
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.newClient` }));
    await user.click(screen.getByRole('button', { name: 'stub-registry-create' }));
    // The new registry is prepended into the picker cache (the select then re-derives its options).
    expect(setData).toHaveBeenCalledWith([QueryKeys.CLIENT_REGISTRIES], expect.any(Function));
    const calls = setData.mock.calls;
    const updater = calls[calls.length - 1]?.[1] as (prev?: ClientRegistry[]) => ClientRegistry[];
    expect(updater([registry])).toEqual([newRegistry, registry]);
    expect(updater(undefined)).toEqual([newRegistry]);
  });

  it('adds and removes product lines and reveals pickup for a rental', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    expect(byId(container, 'order-pickup-at')).toBeNull(); // no rental yet
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-0'), '3');
    await waitFor(() => expect(byId(container, 'order-pickup-at')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.removeLine` }));
    expect(byId(container, 'order-line-product-0')).toBeNull();
  });

  it('shows a live estimate from the picked products, window, and delivery fee', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    setDateTime(byId(container, 'order-delivery-at'), '2026-08-01T14:00');
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-0'), '3');
    await user.type(byId(container, 'order-line-quantity-0'), '25');
    setDateTime(byId(container, 'order-pickup-at'), '2026-08-02T15:00'); // 25h → 2 days
    // 6 × 25 × 2 = 300
    await waitFor(() => expect(screen.getByText('Q 300.00')).toBeInTheDocument());
    // A typed delivery fee folds into the estimate (parseMoney → a number, not the 0 fallback).
    await user.type(byId(container, 'order-delivery-amount'), '50');
    await waitFor(() => expect(screen.getByText('Q 350.00')).toBeInTheDocument());
  });

  it('submits a valid order → invalidates the list, toasts, and navigates', async () => {
    const { container, invalidate, navigateTo } = renderForm();
    const handlers = await fillAndSubmit(container);

    const body = createOrder.mock.calls[0][0];
    expect(body).toMatchObject({
      clientRegistryId: 3,
      eventTypeId: 1,
      deliveryName: 'María López',
      lines: [{ productId: 3, quantity: 25 }],
    });
    expect(body.pickupAt).toBeTruthy();

    act(() => handlers.onSuccess());
    expect(invalidate).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(`${KEY}.successToast`, { title: `${KEY}.successTitle` });
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos');
  });

  it('maps a stock 409 onto the offending line and shows the banner', async () => {
    const { container } = renderForm();
    const handlers = await fillAndSubmit(container);

    act(() =>
      handlers.onError(
        axiosError(409, 'Sin disponibilidad', { conflicts: [{ productId: 3, productName: 'Silla', requested: 25, available: 10 }] }),
      ),
    );
    expect(await screen.findByText(`${KEY}.errors.lineUnavailable`)).toBeInTheDocument();
    expect(screen.getByText('Sin disponibilidad')).toBeInTheDocument();
  });

  it('surfaces a 400 inline and a 500 as a toast', async () => {
    const { container } = renderForm();
    const handlers = await fillAndSubmit(container);
    act(() => handlers.onError(axiosError(400, 'Datos inválidos')));
    expect(await screen.findByText('Datos inválidos')).toBeInTheDocument();
    act(() => handlers.onError(axiosError(500)));
    expect(error).toHaveBeenCalled();
  });

  it('cancel navigates back to the agenda', async () => {
    const { navigateTo } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.cancel` }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos');
  });

  it('ignores a submit while a create is already in flight', async () => {
    useCreateOrder.mockReturnValue({ createOrder, isPending: true });
    const { container } = renderForm();
    await fillValid(container);
    const form = document.getElementById('create-order-form') as HTMLFormElement;
    await act(async () => form.requestSubmit());
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('a 409 without structured conflicts still shows the banner (no per-line mapping)', async () => {
    const { container } = renderForm();
    const handlers = await fillAndSubmit(container);
    act(() => handlers.onError(axiosError(409, 'Conflicto')));
    expect(await screen.findByText('Conflicto')).toBeInTheDocument();
  });

  it('a conflict for a product not in the order is ignored for line mapping', async () => {
    const { container } = renderForm();
    const handlers = await fillAndSubmit(container);
    act(() =>
      handlers.onError(
        axiosError(409, 'Conflicto', { conflicts: [{ productId: 999, productName: 'Otro', requested: 1, available: 0 }] }),
      ),
    );
    // The banner still shows; no line error is mapped (product 999 isn't in the order).
    expect(await screen.findByText('Conflicto')).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.errors.lineUnavailable`)).not.toBeInTheDocument();
  });

  it('prefill tolerates a client with no contacts or addresses', async () => {
    const bare: ClientRegistry = { id: 7, name: 'Solo Nombre', contacts: [], addresses: [], createdAt: 'x' };
    useClientRegistries.mockReturnValue(q({ data: [bare] }));
    const { container } = renderForm();
    await userEvent.selectOptions(byId(container, 'order-client'), '7');
    await waitFor(() =>
      expect((byId(container, 'order-delivery-name') as HTMLInputElement).value).toBe('Solo Nombre'),
    );
    // No contact/address to prefill — those fields stay empty.
    expect((byId(container, 'order-delivery-contact') as HTMLInputElement).value).toBe('');
  });

  it('closes the registry modal when it asks to close', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.newClient` }));
    expect(screen.getByRole('button', { name: 'stub-registry-close' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'stub-registry-close' }));
    expect(screen.queryByRole('button', { name: 'stub-registry-close' })).not.toBeInTheDocument();
  });

  it('mode "both" offers rentals and sales together and keeps a still-fitting line on switch', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    // Add a rental line in rent mode, then switch to Both — the rental still fits, so it survives.
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-0'), '3');
    await user.click(screen.getByRole('radio', { name: `${KEY}.mode.both` }));
    expect(byId(container, 'order-line-product-0')).toBeInTheDocument(); // kept (fits Both)

    const productSelect = byId(container, 'order-line-product-0');
    // The kept line already holds product 3; a NEW line would offer both types — verify the pool.
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    const secondSelect = byId(container, 'order-line-product-1');
    expect(within(secondSelect).queryByRole('option', { name: 'Vasos' })).toBeInTheDocument();
    expect(within(productSelect).queryByRole('option', { name: 'Silla plegable' })).toBeInTheDocument();
  });
});
