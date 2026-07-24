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
const { checkAvailability, useOrderAvailability } = vi.hoisted(() => ({
  checkAvailability: vi.fn(),
  useOrderAvailability: vi.fn(),
}));
vi.mock('./useOrdersCatalog', () => ({ useOrdersCatalog }));
vi.mock('./useOrderProducts', () => ({ useOrderProducts }));
vi.mock('./useClientRegistries', () => ({ useClientRegistries }));
vi.mock('./useCreateOrder', () => ({ useCreateOrder }));
vi.mock('./useOrderAvailability', () => ({ useOrderAvailability }));

const { success, error, warning } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error, warning } }));

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
  contactTypes: [{ id: 1, name: 'WhatsApp' }, { id: 2, name: 'Teléfono' }],
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
  useOrderAvailability.mockReturnValue({ checkAvailability });
  setReady();
});

/** The `onSuccess` from the most recent `checkAvailability` call. */
const availabilityHandlers = (): { onSuccess: (res: unknown) => void } =>
  checkAvailability.mock.calls[checkAvailability.mock.calls.length - 1][1] as { onSuccess: (res: unknown) => void };
const availabilityResponse = (rows: { productId: number; available: number | null }[]) => ({
  data: { data: { availability: rows } },
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
    expect(screen.getByText(`${KEY}.sections.client.title`)).toBeInTheDocument();
    // The interactive body (e.g. the "new client" button) is still a skeleton while loading.
    expect(screen.queryByRole('button', { name: `${KEY}.actions.newClient` })).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: `${KEY}.actions.newClient` })).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.loadError.title`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.emptyProducts.title`)).not.toBeInTheDocument();
  });

  it('smoothly swaps the whole view when the state changes (form → error → back)', async () => {
    const { rerender } = renderForm(); // starts on the form
    expect(screen.getByRole('button', { name: `${KEY}.actions.newClient` })).toBeInTheDocument();

    // A query fails on a refetch → the view sweeps out and the error panel sweeps in.
    useOrdersCatalog.mockReturnValue(q({ isError: true }));
    rerender(<OrderForm />);
    await waitFor(() => expect(screen.getByText(`${KEY}.loadError.title`)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: `${KEY}.actions.newClient` })).not.toBeInTheDocument();

    // Recovery → back to the form, same smooth swap.
    setReady();
    rerender(<OrderForm />);
    await waitFor(() => expect(screen.getByRole('button', { name: `${KEY}.actions.newClient` })).toBeInTheDocument());
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

  it('renders the form sections (no mode fork — the kind is derived from the products)', () => {
    renderForm();
    expect(screen.getByText(`${KEY}.sections.client.title`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.sections.lines.title`)).toBeInTheDocument();
    // No rent/sell/both toggle any more.
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('the product picker offers ALL products (rentals + sales) without a mode filter', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    const productSelect = byId(container, 'order-line-product-0');
    // Both the rental (id 3) and the sale (id 4) are offered.
    expect(within(productSelect).queryByRole('option', { name: 'Silla plegable' })).toBeInTheDocument();
    expect(within(productSelect).queryByRole('option', { name: 'Vasos' })).toBeInTheDocument();
    // Already-picked products are hidden from a second line.
    await user.selectOptions(productSelect, '3');
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    const second = byId(container, 'order-line-product-1');
    expect(within(second).queryByRole('option', { name: 'Silla plegable' })).not.toBeInTheDocument();
    expect(within(second).queryByRole('option', { name: 'Vasos' })).toBeInTheDocument();
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
    // Contact channel + delivery zone pre-selected from the client (principal contact / favorite zone).
    expect((byId(container, 'order-delivery-contact-type') as HTMLSelectElement).value).toBe('1');
    expect(byId(container, 'order-delivery-contact')).toHaveAttribute('inputmode', 'tel');
    expect((byId(container, 'order-delivery-zone') as HTMLSelectElement).value).toBe('6');
    // The saved-data quick-fill pickers appear (the client has contacts + addresses).
    expect(byId(container, 'order-saved-contact')).toBeInTheDocument();
    expect(byId(container, 'order-saved-address')).toBeInTheDocument();
  });

  it('flips the saved pickers to custom when the type/zone changes, and re-matches when they align', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    await user.selectOptions(byId(container, 'order-client'), '3');
    // The principal contact (type 1 / value 5555-1234) and favorite address (zone 6) auto-match.
    await waitFor(() =>
      expect((byId(container, 'order-saved-contact') as HTMLSelectElement).value).toBe('1'),
    );
    expect((byId(container, 'order-saved-address') as HTMLSelectElement).value).toBe('1');

    // Changing the contact TYPE (value unchanged) no longer matches → the picker shows "custom".
    await user.selectOptions(byId(container, 'order-delivery-contact-type'), '2');
    expect((byId(container, 'order-saved-contact') as HTMLSelectElement).value).toBe('');
    // Restoring the type re-matches the saved contact.
    await user.selectOptions(byId(container, 'order-delivery-contact-type'), '1');
    expect((byId(container, 'order-saved-contact') as HTMLSelectElement).value).toBe('1');

    // Changing the delivery ZONE (address text unchanged) flips the address picker to "custom".
    await user.selectOptions(byId(container, 'order-delivery-zone'), '');
    expect((byId(container, 'order-saved-address') as HTMLSelectElement).value).toBe('');
  });

  it('a delivery zone suggests its fee; clearing the zone leaves the fee untouched', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    // Pick a zone with a configured fee → the delivery fee autofills.
    await user.selectOptions(byId(container, 'order-delivery-zone'), '6');
    await waitFor(() =>
      expect((byId(container, 'order-delivery-amount') as HTMLInputElement).value).toBe('50'),
    );
    // Clearing to "no zone" never overwrites the fee (null zone has no fee to apply).
    await user.selectOptions(byId(container, 'order-delivery-zone'), '');
    expect((byId(container, 'order-delivery-amount') as HTMLInputElement).value).toBe('50');
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

  it('adds and removes product lines (both dates are always available)', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    // Both delivery + pickup are always present (set dates before products if you like).
    expect(byId(container, 'order-delivery-at')).toBeInTheDocument();
    expect(byId(container, 'order-pickup-at')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-0'), '3');
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.removeLine` }));
    expect(byId(container, 'order-line-product-0')).toBeNull();
  });

  it('fades the subtotal on quantity, keeps its last value on clear, and collapses on deselect', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-0'), '3');
    await waitFor(() => expect(screen.getByText(/lineUnitEach/)).toBeInTheDocument());
    // Typing a quantity reveals the subtotal segment; clearing it keeps the last amount painted while
    // it fades out (the segment stays in the DOM, just faded).
    await user.type(byId(container, 'order-line-quantity-0'), '3');
    await waitFor(() => expect(screen.getByText(/lineSubtotal/)).toBeInTheDocument());
    await user.clear(byId(container, 'order-line-quantity-0'));
    expect(screen.getByText(/lineSubtotal/)).toBeInTheDocument();
    // Deselecting the product collapses the note but keeps the last text painted through the animation.
    await user.selectOptions(byId(container, 'order-line-product-0'), '');
    expect(screen.getByText(/lineUnitEach/)).toBeInTheDocument();
  });

  it('shows a live estimate from the picked products, window, and delivery fee', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    setDateTime(byId(container, 'order-delivery-at'), '2026-08-01T14:00');
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-0'), '3');
    await user.type(byId(container, 'order-line-quantity-0'), '25');
    setDateTime(byId(container, 'order-pickup-at'), '2026-08-02T15:00'); // 25h → 2 days
    // 6 × 25 × 2 = 300 — shown as the line subtotal AND the products subtotal.
    await waitFor(() => expect(screen.getAllByText('Q 300.00').length).toBeGreaterThan(0));
    // A typed delivery fee folds into the total (parseMoney → a number, not the 0 fallback).
    await user.type(byId(container, 'order-delivery-amount'), '50');
    await waitFor(() => expect(screen.getByText('Q 350.00')).toBeInTheDocument()); // the total
  });

  it('fetches availability on window change, reconciles picked lines, and annotates the picker', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = renderForm();
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-0'), '3');
    await user.type(byId(container, 'order-line-quantity-0'), '10');
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-1'), '4');
    await user.type(byId(container, 'order-line-quantity-1'), '10');
    // Setting the FULL window fires the (debounced) probe with delivery + pickup + all product ids.
    setDateTime(byId(container, 'order-delivery-at'), '2026-08-01T14:00');
    setDateTime(byId(container, 'order-pickup-at'), '2026-08-02T15:00');
    await waitFor(() => expect(checkAvailability).toHaveBeenCalled());
    const body = checkAvailability.mock.calls[checkAvailability.mock.calls.length - 1][0];
    expect(body.deliveryAt).toMatch(/^2026-08-01T/);
    expect(body.pickupAt).toMatch(/^2026-08-02T/);
    expect(body.productIds).toEqual([3, 4]);

    // Sufficient (3: 10 ≥ 10) + unknown (4: null rental window) → nothing changes, no toast.
    act(() => availabilityHandlers().onSuccess(availabilityResponse([{ productId: 3, available: 10 }, { productId: 4, available: null }])));
    expect((byId(container, 'order-line-quantity-0') as HTMLInputElement).value).toBe('10');
    expect(warning).not.toHaveBeenCalled();

    // A conflict: product 3 over the window (reduced to 4), product 4 none left (removed) → a toast.
    act(() => availabilityHandlers().onSuccess(availabilityResponse([{ productId: 3, available: 4 }, { productId: 4, available: 0 }])));
    expect((byId(container, 'order-line-quantity-0') as HTMLInputElement).value).toBe('4');
    expect(byId(container, 'order-line-product-1')).toBeNull(); // product 4 line removed
    expect(warning).toHaveBeenCalled();

    // The picker is annotated: the kept product shows a count; a re-addable one shows sold-out.
    expect(within(byId(container, 'order-line-product-0')).queryByRole('option', { name: /availability\.count/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    expect(within(byId(container, 'order-line-product-1')).queryByRole('option', { name: /availability\.soldOut/ })).toBeInTheDocument();
  }, 20000);

  it('handles adjust-only, remove-only, and empty availability payloads', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = renderForm();
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-0'), '3');
    await user.type(byId(container, 'order-line-quantity-0'), '10');
    setDateTime(byId(container, 'order-delivery-at'), '2026-08-01T14:00');
    await waitFor(() => expect(checkAvailability).toHaveBeenCalled());

    // An empty payload → the `?? []` fallback; nothing to reconcile.
    act(() => availabilityHandlers().onSuccess({ data: {} }));
    expect(warning).not.toHaveBeenCalled();
    expect((byId(container, 'order-line-quantity-0') as HTMLInputElement).value).toBe('10');

    // Only an adjustment (over the window, still some left) → reduced, no removal.
    act(() => availabilityHandlers().onSuccess(availabilityResponse([{ productId: 3, available: 6 }])));
    expect((byId(container, 'order-line-quantity-0') as HTMLInputElement).value).toBe('6');
    expect(warning).toHaveBeenCalledTimes(1);

    // Only a removal (nothing left) → the line is dropped.
    act(() => availabilityHandlers().onSuccess(availabilityResponse([{ productId: 3, available: 0 }])));
    expect(byId(container, 'order-line-product-0')).toBeNull();
    expect(warning).toHaveBeenCalledTimes(2);
  }, 20000);

  it('skips reconciling lines with no product or no quantity yet', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = renderForm();
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-0'), '3'); // product, but NO quantity
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` })); // an empty line (no product)
    setDateTime(byId(container, 'order-delivery-at'), '2026-08-01T14:00');
    await waitFor(() => expect(checkAvailability).toHaveBeenCalled());
    // Product 3 is sold out, but its line has no quantity → left alone; the empty line is skipped too.
    act(() => availabilityHandlers().onSuccess(availabilityResponse([{ productId: 3, available: 0 }])));
    expect(byId(container, 'order-line-product-0')).toBeInTheDocument();
    expect(byId(container, 'order-line-product-1')).toBeInTheDocument();
    expect(warning).not.toHaveBeenCalled();
  }, 20000);

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
});
