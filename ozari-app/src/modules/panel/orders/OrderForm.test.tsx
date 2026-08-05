import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The map picker is a lazy chunk that pulls in Leaflet, which needs real layout jsdom can't give.
// Its own suite covers it; here it is stubbed to the one thing this form cares about — that a
// confirmed pin lands in the submitted body.
vi.mock('@components/LocationPicker', () => ({
  default: ({ onConfirm }: { onConfirm: (coords: { lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onConfirm({ lat: 14.634915, lng: -90.506883 })}>
      confirm-stub
    </button>
  ),
}));

// The four data hooks + the mutation drive every state — mock them.
const { useOrdersCatalog } = vi.hoisted(() => ({ useOrdersCatalog: vi.fn() }));
const { useOrderProducts } = vi.hoisted(() => ({ useOrderProducts: vi.fn() }));
const { useClientRegistries } = vi.hoisted(() => ({ useClientRegistries: vi.fn() }));
const { createOrder, useCreateOrder } = vi.hoisted(() => ({ createOrder: vi.fn(), useCreateOrder: vi.fn() }));
const { updateOrder, useUpdateOrder } = vi.hoisted(() => ({ updateOrder: vi.fn(), useUpdateOrder: vi.fn() }));
const { checkAvailability, useOrderAvailability } = vi.hoisted(() => ({
  checkAvailability: vi.fn(),
  useOrderAvailability: vi.fn(),
}));
vi.mock('./useOrdersCatalog', () => ({ useOrdersCatalog }));
vi.mock('./useOrderProducts', () => ({ useOrderProducts }));
vi.mock('./useClientRegistries', () => ({ useClientRegistries }));
vi.mock('./useCreateOrder', () => ({ useCreateOrder }));
vi.mock('./useUpdateOrder', () => ({ useUpdateOrder }));
vi.mock('./useOrderAvailability', () => ({ useOrderAvailability }));

const { success, error, warning } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error, warning } }));

// The form defaults the "Asignar a" select to the current admin's id (from the token).
const { getStoredUserId } = vi.hoisted(() => ({ getStoredUserId: vi.fn(() => 1) }));
vi.mock('@hooks/useRole', () => ({ getStoredUserId }));

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
  default: ({
    open,
    onCreated,
    onClose,
    registry,
  }: {
    open: boolean;
    onCreated: (r: unknown) => void;
    onClose: () => void;
    registry?: { id: number; name: string };
  }) =>
    open ? (
      <>
        <button type="button" onClick={() => onCreated(newRegistry)}>
          stub-registry-create
        </button>
        {/* Echoes back the registry it was OPENED on, renamed — exactly what an edit hands over. */}
        <button
          type="button"
          onClick={() => onCreated({ ...registry, name: `${registry?.name ?? ''} (editado)` })}
        >
          stub-registry-edit
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
import type { ClientRegistry, OrderCatalog, OrderDetail } from './order.types';
import OrderForm from './OrderForm';
import { reconcileToastDuration } from './SchemaCreateOrder';

const KEY = 'modules.panel.orders.create';
/** The logistics pad's own namespace — a driver conflict never borrows the stock keys. */
const DKEY = 'modules.panel.orders.driverAvailability';

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
  // The deliverable staff the "Asignar a" select offers (id 1 = the current admin, the default).
  assignableUsers: [
    { id: 1, name: 'Romeo Marroquín', role: 'Administrador' },
    { id: 5, name: 'Ana Díaz', role: 'Repartidor' },
  ],
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

const renderForm = (props: { mode?: 'create' | 'edit'; order?: OrderDetail } = {}) => {
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
  const utils = render(<OrderForm {...props} />, { wrapper });
  return { ...utils, invalidate, setData, navigateTo };
};

/** The order the EDIT tests reopen: one rental line, the registry client, a fee already agreed —
 *  and still LIVE, so it reserves its units and the availability caps apply to it. */
const existingOrder = {
  id: 12,
  holdsInventory: true,
  clientRegistryId: 3,
  clientName: 'Cliente de la fiesta',
  eventType: { id: 1, name: 'Evento familiar' },
  deliveryAt: new Date('2026-08-01T14:00:00').toISOString(),
  pickupAt: new Date('2026-08-02T15:00:00').toISOString(),
  deliveryContact: '5555-0000',
  deliveryAddress: 'Salón del club, entrada norte',
  deliveryAmount: 75,
  assignee: { id: 5, name: 'Ana Díaz' },
  paymentMethod: { id: 2, name: 'Transferencia' },
  lines: [{ id: 31, productId: 3, productName: 'Silla plegable', isRental: true, quantity: 25, unitaryPrice: 6, parcialPrice: 300 }],
} as unknown as OrderDetail;

const byId = (container: HTMLElement, id: string) => container.querySelector(`#${id}`) as HTMLElement;

/** Confirm a pin through the location field without loading Leaflet (see the mock at the top). */
const pickLocation = async (): Promise<void> => {
  await userEvent.click(screen.getByTestId('order-delivery-coords-open'));
  await userEvent.click(await screen.findByRole('button', { name: 'confirm-stub' }));
};
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

// Freeze "now" before the fixtures' 2026-08 dates so the delivery's not-in-past rule stays satisfied
// (and the hardcoded future dates don't go stale as the wall clock advances). Restored in afterEach.
const FROZEN_NOW = new Date('2026-07-15T12:00:00').getTime();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  useCreateOrder.mockReturnValue({ createOrder, isPending: false });
  useUpdateOrder.mockReturnValue({ updateOrder, isPending: false });
  useOrderAvailability.mockReturnValue({ checkAvailability });
  setReady();
});

/** The `onSuccess` from the most recent `checkAvailability` call. */
const availabilityHandlers = (): { onSuccess: (res: unknown) => void } =>
  checkAvailability.mock.calls[checkAvailability.mock.calls.length - 1][1] as { onSuccess: (res: unknown) => void };
const availabilityResponse = (rows: { productId: number; available: number | null }[]) => ({
  data: { data: { availability: rows } },
});
/** A probe answer carrying the DRIVER half — the logistics pad's side of the same request. */
const driverResponse = (driver: Record<string, unknown>) => ({
  data: { data: { availability: [], driver } },
});
/**
 * Wait for the probe that asks about the FULL window (delivery *and* pickup). Filling the form
 * fires earlier probes for the partial windows, and an answer to one of those is deliberately
 * discarded — it describes a question the form is no longer asking.
 */
const lastProbeBody = (): Record<string, unknown> | undefined => {
  const calls = checkAvailability.mock.calls;
  return calls.length > 0 ? (calls[calls.length - 1][0] as Record<string, unknown>) : undefined;
};
const waitForFullProbe = (): Promise<void> =>
  waitFor(() => expect(lastProbeBody()?.['pickupAt']).toBeTruthy());
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
    // Straight to the preferences screen, where the missing reference data is actually created.
    expect(navigateTo).toHaveBeenCalledWith('/panel/preferencias');
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

  it('autofills the delivery fee from the client and shows the saved-data pickers', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    await user.selectOptions(byId(container, 'order-client'), '3');
    await waitFor(() =>
      expect((byId(container, 'order-delivery-amount') as HTMLInputElement).value).toBe('50'),
    );
    // The client's PREFERRED payment method is deliberately NOT applied: a preference is not a
    // payment, and writing it here made every order claim a method nobody had used yet.
    expect(container.querySelector('#order-payment-method')).toBeNull();
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

  it('never asks for a payment METHOD — money is recorded when it arrives', async () => {
    // The select is gone entirely (owner decision 2026-08-05): it collected a prediction and stored
    // it as a fact, and being prefilled from the client's *preferred* method it stored a preference
    // as one. "Registrar pago" asks once, when the money is actually observed.
    const { container } = renderForm();
    expect(container.querySelector('#order-payment-method')).toBeNull();

    await fillValid(container);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createOrder).toHaveBeenCalled());
    expect(createOrder.mock.calls[0][0]).not.toHaveProperty('paymentMethodId');
  }, 20000);

  it('defaults the assignee to the current admin and lets it be reassigned to a driver', async () => {
    const { container } = renderForm();
    await fillValid(container);
    // The "Asignar a" select defaults to the creating admin (id 1) — never unassigned.
    expect((byId(container, 'order-assigned-user') as HTMLSelectElement).value).toBe('1');
    // Reassigning to another deliverable staff member sends that id.
    await userEvent.selectOptions(byId(container, 'order-assigned-user'), '5');
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createOrder).toHaveBeenCalled());
    expect(createOrder.mock.calls[0][0].assignedUserId).toBe(5);
    // Explicit timeout like every other test that types through this form: the 5s default
    // is not enough once the whole suite runs in parallel.
  }, 20000);

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

  it('turns the client button into EDIT once a client is chosen, and replaces that row in the cache', async () => {
    const user = userEvent.setup();
    const { container, setData } = renderForm();
    // Nothing selected ⇒ the button creates.
    expect(screen.getByRole('button', { name: `${KEY}.actions.newClient` })).toBeInTheDocument();

    await user.selectOptions(byId(container, 'order-client'), '3');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: `${KEY}.actions.editClient` })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: `${KEY}.actions.newClient` })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `${KEY}.actions.editClient` }));
    await user.click(screen.getByRole('button', { name: 'stub-registry-edit' }));

    // An EDIT replaces the row in place — the same client must never appear twice in the picker.
    const calls = setData.mock.calls;
    const updater = calls[calls.length - 1]?.[1] as (prev?: ClientRegistry[]) => ClientRegistry[];
    const other = { ...registry, id: 99, name: 'Otro Cliente' };
    const next = updater([other, registry]);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(other); // every OTHER row is left exactly as it was
    expect(next[1]?.name).toBe('María López (editado)');
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
    // The toast lists each change on its OWN line (adjusted heading + item, removed heading + item),
    // and lingers longer the more it carries (two changes here).
    const [message, options] = warning.mock.calls[warning.mock.calls.length - 1];
    expect(message).toContain(`${KEY}.availability.adjustedHeading`);
    expect(message).toContain(`${KEY}.availability.adjustedItem`);
    expect(message).toContain(`${KEY}.availability.removedHeading`);
    expect(message).toContain('\n'); // one item per row, not a single joined line
    expect(options).toMatchObject({ title: `${KEY}.availability.reconciledTitle`, duration: reconcileToastDuration(2) });

    // The takeable amount now surfaces as a quiet hint UNDER each line's quantity (the dropdown shows
    // only the product name). The kept line shows its count; a re-added sold-out product shows "Agotado".
    expect(await screen.findByText(`${KEY}.availability.count`)).toBeInTheDocument();
    expect(within(byId(container, 'order-line-product-0')).queryByRole('option', { name: /availability/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-1'), '4');
    expect(await screen.findByText(`${KEY}.availability.soldOut`)).toBeInTheDocument();
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

  it('carries an OPTIONAL map pin into the body, and omits it when none was set', async () => {
    const { container } = renderForm();
    await fillValid(container);

    // Nothing chosen: the body says nothing about a pin at all.
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createOrder).toHaveBeenCalled());
    expect(createOrder.mock.calls[0][0]).not.toHaveProperty('deliveryCoords');

    await pickLocation();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    expect(createOrder.mock.calls[1][0]).toMatchObject({
      deliveryCoords: { lat: 14.634915, lng: -90.506883 },
    });

    // …and removing it goes back to sending nothing, rather than leaving a pin nobody wants.
    await userEvent.click(screen.getByTestId('order-delivery-coords-clear'));
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(3));
    expect(createOrder.mock.calls[2][0]).not.toHaveProperty('deliveryCoords');
  }, 20000);

  it('submits a valid order → invalidates the list, toasts, and navigates', async () => {
    const { container, invalidate, navigateTo } = renderForm();
    const handlers = await fillAndSubmit(container);

    const body = createOrder.mock.calls[0][0];
    expect(body).toMatchObject({
      clientRegistryId: 3,
      eventTypeId: 1,
      deliveryName: 'María López',
      // Defaulted to the creating admin (id 1) — never unassigned.
      assignedUserId: 1,
      lines: [{ productId: 3, quantity: 25 }],
    });
    expect(body.pickupAt).toBeTruthy();

    act(() => handlers.onSuccess());
    expect(invalidate).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(`${KEY}.successToast`, { title: `${KEY}.successTitle` });
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos');
    // Explicit timeout like every other test that runs `fillAndSubmit`: it types through the whole
    // form, which exceeds the 5s default whenever the machine is busy.
  }, 20000);

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
  }, 20000);

  it('probes the DRIVER half too, and puts a clash on the date field with a way out', async () => {
    const user = userEvent.setup({ delay: null });
    const { container, navigateTo } = renderForm();
    await fillValid(container);
    await waitForFullProbe();
    // The assignee rides the same request as the products — one keystroke, both answers.
    expect(lastProbeBody()).toMatchObject({ assignedUserId: 1 });
    expect(lastProbeBody()?.['excludeOrderId']).toBeUndefined();

    act(() =>
      availabilityHandlers().onSuccess(
        driverResponse({
          available: false,
          gapMinutes: 60,
          selfOverlap: false,
          driverName: 'Ana Ruiz',
          conflicts: [
            { orderId: 42, at: new Date('2026-08-01T14:30:00').toISOString(), kind: 'DELIVERY', blocks: 'DELIVERY' },
          ],
        }),
      ),
    );

    // Submitting re-runs the resolver, which layers the live answer on the schema result: the
    // message lands on the DATE (never on a line's quantity — that is the stock conflict's field)
    // and the save is blocked before it can be refused.
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    expect(await screen.findByText(`${DKEY}.conflict`)).toBeInTheDocument();
    expect(createOrder).not.toHaveBeenCalled();

    // …and the admin can go look at the order that is in the way.
    await user.click(screen.getByRole('button', { name: `${DKEY}.viewOrder` }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos/42');
  }, 20000);

  it('marks the PICKUP when the order’s own two events are too close, with nothing to open', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = renderForm();
    await fillValid(container);
    await waitForFullProbe();
    act(() =>
      availabilityHandlers().onSuccess(
        driverResponse({ available: false, gapMinutes: 60, selfOverlap: true, conflicts: [] }),
      ),
    );

    await user.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    expect(await screen.findByText(`${DKEY}.selfOverlap`)).toBeInTheDocument();
    // A self-overlap is two dates of THIS order — there is no other order to look at.
    expect(screen.queryByRole('button', { name: `${DKEY}.viewOrder` })).toBeNull();
    expect(createOrder).not.toHaveBeenCalled();
  }, 20000);

  it('a driver answer stops applying the moment the window changes', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = renderForm();
    await fillValid(container);
    await waitForFullProbe();
    act(() =>
      availabilityHandlers().onSuccess(
        driverResponse({
          available: false,
          gapMinutes: 60,
          selfOverlap: false,
          driverName: 'Ana Ruiz',
          conflicts: [
            { orderId: 42, at: new Date('2026-08-01T14:30:00').toISOString(), kind: 'DELIVERY', blocks: 'COLLECTION' },
          ],
        }),
      ),
    );
    expect(await screen.findByRole('button', { name: `${DKEY}.viewOrder` })).toBeInTheDocument();

    // Moving the delivery asks a different question, so the old answer is discarded immediately —
    // not 400ms later when the next probe lands. Otherwise the form would keep refusing a slot the
    // admin has already left.
    setDateTime(byId(container, 'order-delivery-at'), '2026-08-03T09:00');
    setDateTime(byId(container, 'order-pickup-at'), '2026-08-04T09:00');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: `${DKEY}.viewOrder` })).toBeNull(),
    );
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    await waitFor(() => expect(createOrder).toHaveBeenCalled());
  }, 20000);

  it('words a logistics 409 from the SERVER’s payload, not from the generic fallback', async () => {
    const { container } = renderForm();
    const handlers = await fillAndSubmit(container);

    act(() =>
      handlers.onError(
        axiosError(409, 'Conflicto', {
          driverConflict: {
            orderId: 42,
            at: new Date('2026-08-01T14:30:00').toISOString(),
            kind: 'DELIVERY',
            blocks: 'DELIVERY',
            driverName: 'Ana Ruiz',
            gapMinutes: 60,
          },
        }),
      ),
    );
    // The server's own sentence, not "revisa los datos": it knows who, when and what gap it enforces.
    expect(await screen.findByText(`${DKEY}.saveConflict`)).toBeInTheDocument();

    // A payload without the name still words a sentence (blank rather than "undefined").
    act(() =>
      handlers.onError(
        axiosError(409, 'Conflicto', {
          driverConflict: {
            orderId: 42,
            at: new Date('2026-08-01T14:30:00').toISOString(),
            kind: 'DELIVERY',
            blocks: 'DELIVERY',
            gapMinutes: 60,
          },
        }),
      ),
    );
    expect(await screen.findByText(`${DKEY}.saveConflict`)).toBeInTheDocument();

    act(() => handlers.onError(axiosError(409, 'Conflicto', { selfOverlap: { gapMinutes: 45 } })));
    expect(await screen.findByText(`${DKEY}.saveSelfOverlap`)).toBeInTheDocument();
  }, 20000);

  it('surfaces a 400 inline and a 500 as a toast', async () => {
    const { container } = renderForm();
    const handlers = await fillAndSubmit(container);
    act(() => handlers.onError(axiosError(400, 'Datos inválidos')));
    expect(await screen.findByText('Datos inválidos')).toBeInTheDocument();
    act(() => handlers.onError(axiosError(500)));
    expect(error).toHaveBeenCalled();
    // Explicit timeout like every other test that types through this form: the 5s default
    // is not enough once the whole suite runs in parallel.
  }, 20000);

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
    // Explicit timeout like every other test that types through this form: the 5s default
    // is not enough once the whole suite runs in parallel.
  }, 20000);

  it('a 409 without structured conflicts still shows the banner (no per-line mapping)', async () => {
    const { container } = renderForm();
    const handlers = await fillAndSubmit(container);
    act(() => handlers.onError(axiosError(409, 'Conflicto')));
    expect(await screen.findByText('Conflicto')).toBeInTheDocument();
    // Explicit timeout like every other test that types through this form: the 5s default
    // is not enough once the whole suite runs in parallel.
  }, 20000);

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
    // Explicit timeout like every other test that types through this form: the 5s default
    // is not enough once the whole suite runs in parallel.
  }, 20000);

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

  it('scales the reconciliation toast duration with the number of changes (capped)', () => {
    expect(reconcileToastDuration(1)).toBe(7600); // base 6000 + one 1600 step
    expect(reconcileToastDuration(3)).toBe(10800); // base + three steps
    expect(reconcileToastDuration(50)).toBe(15000); // capped, never overstays
  });

  it('caps a line quantity at the product availability and blocks an over-stock submit', async () => {
    const user = userEvent.setup({ delay: null });
    // A product carrying an Admin availability baseline — the cap exists even before a window is set.
    useOrderProducts.mockReturnValue(q({ data: [{ ...rentalProduct, available: 5 }] }));
    const { container } = renderForm();
    await user.selectOptions(byId(container, 'order-client'), '3');
    await user.selectOptions(byId(container, 'order-event-type'), '1');
    setDateTime(byId(container, 'order-delivery-at'), '2026-08-01T14:00');
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addLine` }));
    await user.selectOptions(byId(container, 'order-line-product-0'), '3');
    // The input advertises the takeable ceiling as its native max.
    expect(byId(container, 'order-line-quantity-0')).toHaveAttribute('max', '5');
    // Typing over the baseline + submitting is blocked with the per-line "only N available" message.
    await user.type(byId(container, 'order-line-quantity-0'), '9');
    await waitFor(() => expect(byId(container, 'order-pickup-at')).toBeInTheDocument());
    setDateTime(byId(container, 'order-pickup-at'), '2026-08-02T15:00');
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.submit` }));
    expect(await screen.findByText(`${KEY}.errors.lineUnavailable`)).toBeInTheDocument();
    expect(createOrder).not.toHaveBeenCalled();
  }, 20000);
});

describe('OrderForm (edit mode)', () => {
  const EKEY = 'modules.panel.orders.edit';

  it('reopens on the order EXACTLY as it stands, and saving an untouched form sends it back', async () => {
    const { container, invalidate, setData, navigateTo } = renderForm({
      mode: 'edit',
      order: existingOrder,
    });

    // Every value is the order's own — including the client, whose current defaults must NOT
    // overwrite the snapshots that were actually agreed for this event.
    expect(byId(container, 'order-client')).toHaveValue('3');
    expect(byId(container, 'order-delivery-address')).toHaveValue('Salón del club, entrada norte');
    expect(byId(container, 'order-delivery-contact')).toHaveValue('5555-0000');
    expect(byId(container, 'order-delivery-amount')).toHaveValue(75);
    expect(byId(container, 'order-assigned-user')).toHaveValue('5');
    expect(byId(container, 'order-line-quantity-0')).toHaveValue(25);

    await userEvent.click(screen.getByRole('button', { name: `${EKEY}.actions.submit` }));
    await waitFor(() => expect(updateOrder).toHaveBeenCalled());
    expect(createOrder).not.toHaveBeenCalled();
    const [payload, handlers] = updateOrder.mock.calls[0] as [
      { orderId: number; body: Record<string, unknown> },
      { onSuccess: (response: unknown) => void; onError: (e: unknown) => void },
    ];
    expect(payload.orderId).toBe(12);
    expect(payload.body).toMatchObject({
      clientRegistryId: 3,
      eventTypeId: 1,
      deliveryName: 'Cliente de la fiesta',
      deliveryAddress: 'Salón del club, entrada norte',
      deliveryAmount: 75,
      assignedUserId: 5,
      lines: [{ productId: 3, quantity: 25 }],
    });
    // An edit can never rewrite how the order was PAID — the field is not in the body at all, so a
    // full-state save cannot erase a recorded payment.
    expect(payload.body).not.toHaveProperty('paymentMethodId');

    // The response IS the re-projected order: it seeds the detail cache so arriving back shows the
    // saved state with no flash of the values we just replaced…
    const saved = { id: 12, clientName: 'Cliente de la fiesta', totalAmount: 675 };
    handlers.onSuccess({ data: { data: { order: saved } } });
    expect(setData).toHaveBeenCalledWith([QueryKeys.ORDER, 12], saved);
    // …and BOTH caches then re-sync from the server (the order may have been advanced meanwhile;
    // the agenda row shows this order's dates, client and total).
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDERS] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDER, 12] });
    expect(success).toHaveBeenCalled();
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos/12');
  }, 20000);

  it('still re-syncs when the response carries no envelope', async () => {
    const { setData, invalidate } = renderForm({ mode: 'edit', order: existingOrder });
    await userEvent.click(screen.getByRole('button', { name: `${EKEY}.actions.submit` }));
    await waitFor(() => expect(updateOrder).toHaveBeenCalled());
    const handlers = updateOrder.mock.calls[0][1] as { onSuccess: (r: unknown) => void };

    handlers.onSuccess({ data: {} });
    expect(setData).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [QueryKeys.ORDER, 12] });
  }, 20000);

  it('lets an EDIT move the delivery date freely — a correction is not a scheduling decision', async () => {
    const { container } = renderForm({ mode: 'edit', order: existingOrder });
    // No native floor: the picker must not fight the rule the schema drops.
    expect(byId(container, 'order-delivery-at')).not.toHaveAttribute('min');

    // A date well before "now" saves without complaint (the pickup rule still applies).
    setDateTime(byId(container, 'order-delivery-at'), '2026-07-01T09:00');
    setDateTime(byId(container, 'order-pickup-at'), '2026-07-02T09:00');
    await userEvent.click(screen.getByRole('button', { name: `${EKEY}.actions.submit` }));
    await waitFor(() => expect(updateOrder).toHaveBeenCalled());
    expect(screen.queryByText(`${KEY}.errors.deliveryInPast`)).not.toBeInTheDocument();
  }, 20000);

  it('routes an edit failure through the same doctrine as create (per-line 409 + inline banner)', async () => {
    renderForm({ mode: 'edit', order: existingOrder });
    await userEvent.click(screen.getByRole('button', { name: `${EKEY}.actions.submit` }));
    await waitFor(() => expect(updateOrder).toHaveBeenCalled());
    const handlers = updateOrder.mock.calls[0][1] as Handlers;

    handlers.onError(
      axiosError(409, undefined, {
        conflicts: [{ productId: 3, productName: 'Silla plegable', requested: 25, available: 4 }],
      }),
    );
    expect(await screen.findByText(`${KEY}.errors.lineUnavailable`)).toBeInTheDocument();
  }, 20000);

  it('excludes ITSELF from the driver probe — an order cannot block its own dates', async () => {
    renderForm({ mode: 'edit', order: existingOrder });
    await waitFor(() => expect(checkAvailability).toHaveBeenCalled());
    // Without this the order would clash with the two blocks it already occupies, and every edit
    // would open reporting a conflict with itself.
    expect(lastProbeBody()).toMatchObject({ excludeOrderId: 12, assignedUserId: 5 });
  }, 20000);

  it('applies NO stock cap to an order that reserves nothing — paperwork, not a claim', async () => {
    // Cancelled or finished: the server moves no stock for this edit and can never 409 on it, so
    // the form must not cap either. It used to clamp the input's `max`, quote a ceiling in the
    // hint, and silently REDUCE the historical quantity to today's shelf on the next probe.
    const finished = { ...existingOrder, holdsInventory: false } as unknown as OrderDetail;
    const { container } = renderForm({ mode: 'edit', order: finished });
    await waitFor(() => expect(checkAvailability).toHaveBeenCalled());

    act(() => availabilityHandlers().onSuccess(availabilityResponse([{ productId: 3, available: 2 }])));

    expect((byId(container, 'order-line-quantity-0') as HTMLInputElement).value).toBe('25');
    expect(byId(container, 'order-line-quantity-0')).not.toHaveAttribute('max');
    expect(warning).not.toHaveBeenCalled();
    expect(screen.queryByText(`${KEY}.availability.count`)).not.toBeInTheDocument();

    // And it still SAVES: the resolver adds no line error for a quantity above the shelf.
    await userEvent.click(screen.getByRole('button', { name: `${EKEY}.actions.submit` }));
    await waitFor(() => expect(updateOrder).toHaveBeenCalled());
  }, 20000);

  it('keeps capping a LIVE order — the exception is the exception', async () => {
    const { container } = renderForm({ mode: 'edit', order: existingOrder });
    await waitFor(() => expect(checkAvailability).toHaveBeenCalled());

    act(() => availabilityHandlers().onSuccess(availabilityResponse([{ productId: 3, available: 2 }])));

    expect((byId(container, 'order-line-quantity-0') as HTMLInputElement).value).toBe('2');
    expect(warning).toHaveBeenCalled();
  }, 20000);

  it('backs out to the ORDER, not the agenda — you came from the order', async () => {
    const { navigateTo } = renderForm({ mode: 'edit', order: existingOrder });
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.cancel` }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos/12');
  });
});

