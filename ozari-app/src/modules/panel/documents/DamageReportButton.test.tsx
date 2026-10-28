import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { usePreferences } = vi.hoisted(() => ({ usePreferences: vi.fn() }));
vi.mock('../preferences/usePreferences', () => ({ usePreferences }));

const { downloadDamageReport } = vi.hoisted(() => ({
  // The SIGNATURE is declared so the assertions can read the MODEL the button built.
  downloadDamageReport: vi.fn<(input: unknown) => Promise<void>>(() => Promise.resolve()),
}));
vi.mock('./downloadDocument', () => ({ downloadDamageReport }));

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@components/notifications/notify', () => ({ notify }));

import DamageReportButton from './DamageReportButton';
import type { DownloadDamageReportInput } from './downloadDocument';
import type { OrderDepositSettlement, OrderDetail } from '../orders/order.types';

const KEY = 'modules.panel.documents';
const LABEL = `${KEY}.actions.damageReport`;

const order = {
  id: 42,
  clientName: 'Test cliente',
  eventType: { id: 1, name: 'Boda' },
  currency: { id: 2, iso4217Code: 'USD', name: 'Dólar', symbol: '$' },
  deliveryContact: '1234-1234',
  deliveryAddress: 'Test dirección',
  serviceStart: '2026-07-29T17:50:00Z',
  serviceEnd: '2026-07-31T22:50:00Z',
  pickupAt: '2026-07-31T22:50:00Z',
  securityDeposit: { total: 100, canSettle: true },
  lines: [
    {
      id: 1,
      productId: 1,
      productName: 'Mesa',
      isRental: true,
      quantity: 2,
      unitaryPrice: 10,
      parcialPrice: 60,
      securityDeposit: 50,
      damagedQuantity: 1,
    },
  ],
} as unknown as OrderDetail;

const settlement: OrderDepositSettlement = {
  settledAt: '2026-08-01T10:00:00Z',
  retainedAmount: 20,
  retainedReason: 'Mantel manchado',
  damages: [{ lineId: 1, productName: 'Mesa', quantity: 1, unitAmount: 300, amount: 300 }],
  damagesTotal: 300,
  claimsTotal: 320,
  appliedFromDeposit: 100,
  refundAmount: 0,
  balanceDue: 220,
};

const lastInput = (): DownloadDamageReportInput =>
  downloadDamageReport.mock.calls[0]?.[0] as unknown as DownloadDamageReportInput;

beforeEach(() => {
  vi.clearAllMocks();
  usePreferences.mockReturnValue({
    data: {
      settings: [],
      catalogs: {
        bankAccounts: [
          {
            id: 3,
            name: 'Banrural',
            isActive: true,
            bankKey: 'banrural',
            accountType: 'Monetaria',
            accountNumber: '3-456',
            holder: 'Party Rentals GT',
            isReferenced: false,
          },
        ],
      },
    },
  });
});

describe('DamageReportButton', () => {
  it('builds the FINAL report from the saved settlement', async () => {
    render(<DamageReportButton order={order} settlement={settlement} />);
    await userEvent.click(screen.getByRole('button', { name: LABEL }));
    await waitFor(() => expect(downloadDamageReport).toHaveBeenCalled());
    const { model } = lastInput();
    expect(model.draft).toBe(false);
    expect(model.reference).toBe(42);
    expect(model.settledAt).toEqual(new Date('2026-08-01T10:00:00Z'));
    expect(model.totals.balanceDue).toBe(220);
    // The banks travel with the letterhead — the template prints them only when a balance is due.
    expect(model.letterhead.banks).toHaveLength(1);
  });

  it('marks a report built from unsaved form values as a DRAFT', async () => {
    render(<DamageReportButton order={order} settlement={settlement} draft />);
    await userEvent.click(screen.getByRole('button', { name: LABEL }));
    await waitFor(() => expect(downloadDamageReport).toHaveBeenCalled());
    expect(lastInput().model.draft).toBe(true);
    // A draft has recorded nothing, so it states no settlement date.
    expect(lastInput().model.settledAt).toBeUndefined();
  });

  it('hands the template the order’s currency and the shared formatters', async () => {
    render(<DamageReportButton order={order} settlement={settlement} />);
    await userEvent.click(screen.getByRole('button', { name: LABEL }));
    await waitFor(() => expect(downloadDamageReport).toHaveBeenCalled());
    const input = lastInput();
    // The ORDER's symbol, never a hardcoded Q.
    expect(input.money(1250)).toBe('$ 1,250.00');
    const moment = new Date('2026-08-06T15:30:00Z');
    expect(input.date(moment)).toMatch(/2026/);
    expect(input.dateTime(moment)).toMatch(/\d/);
    // The vocabulary is the report's own, on top of the shared frame words — and every leaf is
    // contract-checked by the global `t` mock (the key must exist in es.json).
    expect(input.copy.title).toBe(`${KEY}.damageReport.title`);
    expect(input.copy.draftMark).toBe(`${KEY}.damageReport.draftMark`);
    expect(input.copy.balanceDue).toBe(`${KEY}.damageReport.totals.balanceDue`);
    expect(input.copy.reference).toBe(`${KEY}.fields.reference`);
    expect(input.copy.page(1, 2)).toBe(`${KEY}.fields.page`);
    // Interpolated by i18next — the contract mock throws if a placeholder is left unfilled.
    expect(input.copy.claimsBreakdown('$ 20.00', '$ 300.00')).toBe(
      `${KEY}.damageReport.totals.claimsBreakdown`,
    );
    expect(input.copy.refundNote('$ 100.00')).toBe(`${KEY}.damageReport.totals.refundNote`);
  });

  it('is BUSY while the document is being produced, and comes back afterwards', async () => {
    let finish: () => void = () => undefined;
    downloadDamageReport.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<DamageReportButton order={order} settlement={settlement} />);
    const button = screen.getByRole('button', { name: LABEL });
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('aria-busy', 'true');
    finish();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('TOASTS a failure — nothing on the page changed, the file simply did not arrive', async () => {
    downloadDamageReport.mockRejectedValueOnce(new Error('chunk failed'));
    render(<DamageReportButton order={order} settlement={settlement} />);
    const button = screen.getByRole('button', { name: LABEL });
    await userEvent.click(button);
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(`${KEY}.errors.failed`));
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('is never a SUBMIT button — it lives inside the report-damages form', () => {
    render(<DamageReportButton order={order} settlement={settlement} draft />);
    expect(screen.getByRole('button', { name: LABEL })).toHaveAttribute('type', 'button');
  });
});
