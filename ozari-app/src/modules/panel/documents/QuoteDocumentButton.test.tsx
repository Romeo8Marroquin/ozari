import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { usePreferences } = vi.hoisted(() => ({ usePreferences: vi.fn() }));
vi.mock('../preferences/usePreferences', () => ({ usePreferences }));

const { downloadDocument } = vi.hoisted(() => ({
  downloadDocument: vi.fn<(input: unknown) => Promise<void>>(() => Promise.resolve()),
}));
vi.mock('./downloadDocument', () => ({ downloadDocument }));

const { notify } = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@components/notifications/notify', () => ({ notify }));

// The component's whole job is deciding WHEN to build a document, so the form context is stubbed
// rather than mounted: a real `useForm` with no resolver would make `trigger()` always pass, which
// is precisely the branch that matters here.
const { trigger, getValues } = vi.hoisted(() => ({
  trigger: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  getValues: vi.fn(),
}));
vi.mock('react-hook-form', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-hook-form')>()),
  useFormContext: () => ({ trigger, getValues }),
}));

import QuoteDocumentButton from './QuoteDocumentButton';
import { createOrderDefaultValues } from '../orders/SchemaCreateOrder';
import type { DownloadDocumentInput } from './downloadDocument';
import type { CatalogOption, ClientRegistry } from '../orders/order.types';
import type { CreateOrderFormType } from '../orders/SchemaCreateOrder';
import type { Product } from '../products/product.types';

const KEY = 'modules.panel.documents';

const product = {
  id: 1,
  name: 'Mesa redonda',
  businessTypeId: 1,
  rentTimeUnitId: 2,
  rentPrice: 10,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
} as unknown as Product;

const values = {
  ...createOrderDefaultValues,
  eventTypeId: 1,
  clientRegistryId: 7,
  deliveryAt: '2026-07-29T11:50',
  pickupAt: '2026-07-31T16:50',
  deliveryName: 'Quien recibe',
  deliveryContact: '1234-1234',
  deliveryAddress: 'Test dirección',
  lines: [{ productId: 1, quantity: '5', isRental: true }],
} as CreateOrderFormType;

const REGISTRIES = [{ id: 7, name: 'Cliente de prueba' }] as ClientRegistry[];
const EVENT_TYPES = [{ id: 1, name: 'Boda' }] as CatalogOption[];

const setup = (
  products: Product[] = [product],
  registries: ClientRegistry[] = REGISTRIES,
  eventTypes: CatalogOption[] = EVENT_TYPES,
) =>
  render(
    <QuoteDocumentButton
      productsById={new Map(products.map((p) => [p.id, p]))}
      registries={registries}
      eventTypes={eventTypes}
    />,
  );

const click = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.quote` }));
};

const lastInput = (): DownloadDocumentInput =>
  downloadDocument.mock.calls[0]?.[0] as unknown as DownloadDocumentInput;

beforeEach(() => {
  vi.clearAllMocks();
  trigger.mockResolvedValue(true);
  getValues.mockReturnValue(values);
  usePreferences.mockReturnValue({
    data: {
      settings: [
        {
          key: 'documents.businessName',
          type: 'text',
          value: 'Party Rentals GT',
          minLength: 2,
          maxLength: 120,
          multiline: false,
          group: 'documents',
        },
      ],
      catalogs: { bankAccounts: [] },
    },
  });
});

describe('QuoteDocumentButton', () => {
  it('quotes from UNSAVED values — the whole point of the action', async () => {
    setup();
    await click();
    await waitFor(() => expect(downloadDocument).toHaveBeenCalled());
    const { model } = lastInput();
    expect(model.kind).toBe('quote');
    // 3 started days × 5 × Q10, straight from the form's own estimate.
    expect(model.totals.total).toBe(150);
    // Nothing was saved, so there is no order to name.
    expect(model.reference).toBeUndefined();
  });

  it('runs the SAME resolver that guards submit, and produces nothing when it fails', async () => {
    // "No document from an incomplete form" (owner decision #2). The gate is a check on click
    // rather than a disabled button, so the form lights up which field is missing.
    trigger.mockResolvedValue(false);
    setup();
    await click();
    await waitFor(() => expect(notify.warning).toHaveBeenCalledWith(`${KEY}.errors.incompleteForm`));
    expect(downloadDocument).not.toHaveBeenCalled();
  });

  it('refuses to build a document from values it cannot read', async () => {
    // Defence in depth: the resolver passed, but every line points at a product the cache no longer
    // holds. A PDF with no priced line is worse than no PDF.
    setup([]);
    await click();
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(`${KEY}.errors.failed`));
    expect(downloadDocument).not.toHaveBeenCalled();
  });

  it('speaks the SAME vocabulary as the comprobante, with its own title', async () => {
    setup();
    await click();
    await waitFor(() => expect(downloadDocument).toHaveBeenCalled());
    const input = lastInput();
    expect(input.copy.title).toBe(`${KEY}.quote.title`);
    // Shared leaves — the two documents must never call the same column different things.
    expect(input.copy.columnQuantity).toBe(`${KEY}.columns.quantity`);
    // The symbol comes from the products quoted, never a hardcoded Q.
    expect(input.money(1250)).toBe('Q 1,250.00');
    // Dates are formatted by the CALLER, so the PDF never grows a second, subtly different set of
    // rules of its own. A delivery needs its hour; an issue date does not.
    const moment = new Date('2026-08-06T15:30:00Z');
    expect(input.date(moment)).toMatch(/2026/);
    expect(input.dateTime(moment)).toMatch(/\d/);
  });

  it('addresses the quote to the saved CLIENT, and names the event', async () => {
    setup();
    await click();
    await waitFor(() => expect(downloadDocument).toHaveBeenCalled());
    expect(lastInput().model.client.name).toBe('Cliente de prueba');
    expect(lastInput().model.event.type).toBe('Boda');
  });

  it('leaves the event type BLANK rather than failing when the catalog cannot name it', async () => {
    // Only reachable with a catalog that loaded empty — the button is disabled until the reference
    // data is ready. A missing label is a thinner document; it is never a reason not to quote.
    setup([product], REGISTRIES, []);
    await click();
    await waitFor(() => expect(downloadDocument).toHaveBeenCalled());
    expect(lastInput().model.event.type).toBe('');
  });

  it('falls back to whoever RECEIVES it when the client is not saved yet', async () => {
    // Quoting a walk-in on the phone, before they exist as a registry row, is the whole point of
    // the action — the page still has a name on it.
    setup([product], []);
    await click();
    await waitFor(() => expect(downloadDocument).toHaveBeenCalled());
    expect(lastInput().model.client.name).toBe('Quien recibe');
  });

  it('TOASTS a failure — nothing on the form changed, the file simply did not arrive', async () => {
    downloadDocument.mockRejectedValueOnce(new Error('chunk failed'));
    setup();
    const button = screen.getByRole('button', { name: `${KEY}.actions.quote` });
    await click();
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(`${KEY}.errors.failed`));
    // And it comes back: the likeliest cause is the lazy chunk failing on a bad connection.
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('is disabled while the form has no data to quote from', () => {
    // The only legitimate disabled state: the reference data has not loaded, so there is nothing to
    // price against. An INCOMPLETE form is a different thing and stays clickable — see above.
    render(
      <QuoteDocumentButton
        productsById={new Map()}
        registries={REGISTRIES}
        eventTypes={EVENT_TYPES}
        disabled
      />,
    );
    expect(screen.getByRole('button', { name: `${KEY}.actions.quote` })).toBeDisabled();
  });
});
