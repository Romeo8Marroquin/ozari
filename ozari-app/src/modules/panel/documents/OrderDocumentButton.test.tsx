import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { usePreferences } = vi.hoisted(() => ({ usePreferences: vi.fn() }));
vi.mock('../preferences/usePreferences', () => ({ usePreferences }));

const { downloadDocument } = vi.hoisted(() => ({
  // The SIGNATURE is declared so the assertions can read the MODEL the button built.
  downloadDocument: vi.fn<(input: unknown) => Promise<void>>(() => Promise.resolve()),
}));
vi.mock('./downloadDocument', () => ({ downloadDocument }));

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@components/notifications/notify', () => ({ notify }));

import OrderDocumentButton from './OrderDocumentButton';
import type { DownloadDocumentInput } from './downloadDocument';
import type { OrderDetail } from '../orders/order.types';

const KEY = 'modules.panel.documents';

const order = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: 42,
    clientName: 'Test cliente',
    eventType: { id: 1, name: 'Evento familiar' },
    currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
    isPaid: false,
    totalAmount: 150,
    deliveryContact: '1234-1234',
    deliveryAddress: 'Test dirección',
    serviceStart: '2026-07-29T17:50:00Z',
    serviceEnd: '2026-07-31T22:50:00Z',
    pickupAt: '2026-07-31T22:50:00Z',
    lines: [
      {
        id: 1,
        productId: 1,
        productName: 'Mesa',
        isRental: true,
        quantity: 5,
        unitaryPrice: 10,
        parcialPrice: 150,
      },
    ],
    ...over,
  }) as unknown as OrderDetail;

const preferences = (over: Record<string, unknown> = {}) => ({
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
    catalogs: {
      bankAccounts: [
        {
          id: 3,
          name: 'Banrural monetaria',
          isActive: true,
          bankKey: 'banrural',
          accountType: 'Monetaria',
          accountNumber: '3-456-78901-2',
          holder: 'Party Rentals GT, S.A.',
          isReferenced: false,
        },
        {
          id: 4,
          name: 'Cuenta retirada',
          isActive: false,
          bankKey: null,
          accountType: 'Ahorro',
          accountNumber: '9-999',
          holder: 'Antiguo',
          isReferenced: false,
        },
      ],
    },
    ...over,
  },
});

const lastInput = (): DownloadDocumentInput =>
  downloadDocument.mock.calls[0]?.[0] as unknown as DownloadDocumentInput;

beforeEach(() => {
  vi.clearAllMocks();
  usePreferences.mockReturnValue(preferences());
});

describe('OrderDocumentButton', () => {
  it('is offered at EVERY step — a document is how the client is told what they owe', async () => {
    // Not gated on delivery, and not gated on payment: an order still "En ruta" is exactly when the
    // admin needs to send one.
    render(<OrderDocumentButton order={order()} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.download` }));
    await waitFor(() => expect(downloadDocument).toHaveBeenCalled());
    expect(lastInput().model.reference).toBe(42);
  });

  it('renders NOTHING for a cancelled order', () => {
    // There is no agreement left to document, and a cancelled order's figures handed to a client
    // would read as a live bill. Absent rather than disabled: a greyed control invites a hunt for
    // the condition that would enable it, and there isn't one.
    const { container } = render(<OrderDocumentButton order={order({ cancelledAt: '2026-08-01T00:00:00Z' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('carries the PAID state through, so the same page becomes proof of payment', async () => {
    render(<OrderDocumentButton order={order({ isPaid: true })} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.download` }));
    await waitFor(() => expect(downloadDocument).toHaveBeenCalled());
    expect(lastInput().model.isPaid).toBe(true);
    expect(lastInput().model.totals.balance).toBe(0);
  });

  it('prints only the PUBLISHED bank accounts', async () => {
    // An unpublished account is one the admin retired; printing it would invite a deposit into an
    // account the business no longer watches.
    render(<OrderDocumentButton order={order()} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.download` }));
    await waitFor(() => expect(downloadDocument).toHaveBeenCalled());
    expect(lastInput().model.letterhead.banks).toEqual([
      {
        name: 'Banrural monetaria',
        bankKey: 'banrural',
        accountType: 'Monetaria',
        accountNumber: '3-456-78901-2',
        holder: 'Party Rentals GT, S.A.',
      },
    ]);
  });

  it('hands the template ONE vocabulary for money, dates and page numbers', async () => {
    // The template is pure layout, so every format it prints arrives as a function from here —
    // which is what stops a second, subtly different set of rules living inside the PDF.
    render(<OrderDocumentButton order={order({ currency: { id: 2, iso4217Code: 'USD', name: 'Dólar', symbol: '$' } })} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.download` }));
    await waitFor(() => expect(downloadDocument).toHaveBeenCalled());
    const input = lastInput();

    // The symbol is the ORDER's, never a hardcoded Q — the repo-wide currency rule.
    expect(input.money(1250)).toBe('$ 1,250.00');
    const moment = new Date('2026-08-06T15:30:00Z');
    expect(input.date(moment)).toMatch(/2026/);
    // A delivery needs its hour; an issue date does not.
    expect(input.dateTime(moment)).toMatch(/\d/);
    // Real i18next interpolation, not a placeholder the template string-replaces: the numbers only
    // exist inside react-pdf's per-page render, and an unfilled `{{page}}` would reach the client.
    expect(input.copy.page(1, 2)).toBe(`${KEY}.fields.page`);
    // Same reason the billed days are a function: the template must never build "3" + " días"
    // itself, because "1 días" is the kind of slip that makes a client distrust the whole page.
    // The global `t` mock returns the key, so what this pins is that the PLURAL leaf is asked for.
    expect(input.copy.billedDaysValue(1)).toBe(`${KEY}.fields.billedDaysValue`);
    expect(input.copy.billedDaysValue(3)).toBe(`${KEY}.fields.billedDaysValue`);
  });

  it('still produces a document when the preferences have not loaded', async () => {
    // A letterhead we could not read is a thinner document, not a broken button — and the admin
    // asked for the figures, which do not come from preferences at all.
    usePreferences.mockReturnValue({ data: undefined });
    render(<OrderDocumentButton order={order()} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.download` }));
    await waitFor(() => expect(downloadDocument).toHaveBeenCalled());
    expect(lastInput().model.letterhead.banks).toEqual([]);
  });

  it('tolerates a bank row missing its decrypted fields', async () => {
    usePreferences.mockReturnValue(
      preferences({
        catalogs: { bankAccounts: [{ id: 5, name: 'Parcial', isActive: true, isReferenced: false }] },
      }),
    );
    render(<OrderDocumentButton order={order()} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.download` }));
    await waitFor(() => expect(downloadDocument).toHaveBeenCalled());
    expect(lastInput().model.letterhead.banks[0]).toEqual({
      name: 'Parcial',
      bankKey: null,
      accountType: '',
      accountNumber: '',
      holder: '',
    });
  });

  it('TOASTS a failure — nothing on the page changed, the file simply did not arrive', async () => {
    downloadDocument.mockRejectedValueOnce(new Error('chunk failed'));
    render(<OrderDocumentButton order={order()} />);
    const button = screen.getByRole('button', { name: `${KEY}.actions.download` });
    await userEvent.click(button);
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(`${KEY}.errors.failed`));
    // And the button comes back — the most likely cause is a lazy chunk failing on a bad
    // connection, which a retry fixes.
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
