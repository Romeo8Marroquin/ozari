import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// The damage report download is the documents' own component (and suite); here it is a marker that
// records WHICH settlement it was handed.
vi.mock('../documents/DamageReportButton', () => ({
  default: ({ settlement }: { settlement: { claimsTotal: number } }) => (
    <span data-testid="damage-report">{settlement.claimsTotal}</span>
  ),
}));

import type { OrderDepositSettlement, OrderDetail, OrderSecurityDeposit } from './order.types';
import OrderDepositCard from './OrderDepositCard';

const K = 'modules.panel.orders.detail.deposit';

const order = {
  id: 12,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
} as OrderDetail;

const settlement = (over: Partial<OrderDepositSettlement> = {}): OrderDepositSettlement => ({
  settledAt: new Date('2026-08-03T10:00:00').toISOString(),
  retainedAmount: 30,
  retainedReason: 'Golpe en la esquina',
  damages: [
    {
      lineId: 31,
      productName: 'Mantel blanco',
      quantity: 2,
      unitAmount: 120,
      amount: 240,
      note: 'Se quemaron',
    },
  ],
  damagesTotal: 240,
  claimsTotal: 270,
  appliedFromDeposit: 200,
  refundAmount: 0,
  balanceDue: 70,
  ...over,
});

const clean = (): OrderDepositSettlement =>
  settlement({
    retainedAmount: 0,
    retainedReason: undefined,
    damages: [],
    damagesTotal: 0,
    claimsTotal: 0,
    appliedFromDeposit: 0,
    refundAmount: 200,
    balanceDue: 0,
  });

const renderCard = (deposit: OrderSecurityDeposit, isAdmin = true) => {
  const onRefund = vi.fn();
  const onReport = vi.fn();
  const onUndo = vi.fn();
  const onCollection = vi.fn();
  render(
    <OrderDepositCard
      order={order}
      deposit={deposit}
      isAdmin={isAdmin}
      onRefund={onRefund}
      onReport={onReport}
      onUndo={onUndo}
      onCollection={onCollection}
    />,
  );
  return { onRefund, onReport, onUndo, onCollection };
};

const C = `${K}.collection`;

describe('OrderDepositCard', () => {
  it('before delivery: the total and "después de la entrega", nothing to press', () => {
    renderCard({ total: 200, held: 200, canSettle: false });
    expect(screen.getByRole('heading', { name: `${K}.title` })).toBeInTheDocument();
    expect(screen.getByText(/Q\s*200\.00/)).toBeInTheDocument();
    // Collected ON TOP of the order — said where the amount is.
    expect(screen.getByText(`${K}.totalNote`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.notYet`)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.chipPending`)).not.toBeInTheDocument();
  });

  it('delivered, pending: the HAPPY path leads ("Devolver depósito"), the damage path follows', async () => {
    const { onRefund, onReport } = renderCard({ total: 200, held: 200, canSettle: true });
    expect(screen.getByText(`${K}.chipPending`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.due`)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName(`${K}.refundAction`);
    expect(buttons[1]).toHaveAccessibleName(`${K}.report`);
    await userEvent.click(buttons[0]);
    expect(onRefund).toHaveBeenCalled();
    await userEvent.click(buttons[1]);
    expect(onReport).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: `${K}.undo` })).not.toBeInTheDocument();
    expect(screen.queryByTestId('damage-report')).not.toBeInTheDocument();
  });

  it('replacement values only (no deposit): the quick action reads "Sin daños"', () => {
    renderCard({ total: 0, held: 0, canSettle: true });
    expect(screen.getByText(`${K}.dueNoDeposit`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${K}.noDamageAction` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${K}.refundAction` })).not.toBeInTheDocument();
  });

  it('a non-admin sees the state but no actions (the endpoints are Admin-only)', () => {
    renderCard({ total: 200, held: 200, canSettle: true, settlement: settlement() }, false);
    expect(screen.getByText(`${K}.chipDamaged`)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('damage-report')).not.toBeInTheDocument();
  });

  it('with damages: the API\'s breakdown verbatim, "Con daños", the report, edit and undo', async () => {
    const { onReport, onUndo } = renderCard({
      total: 200,
      held: 200,
      canSettle: true,
      settlement: settlement(),
    });
    expect(screen.getByText(`${K}.chipDamaged`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.retained`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.reason`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.damage`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.note`)).toBeInTheDocument();
    expect(screen.getByText(/−Q\s*240\.00/)).toBeInTheDocument();
    expect(screen.getByText(`${K}.refund`)).toBeInTheDocument();
    // The balance is the API's number (Q70), not something this card re-derived.
    expect(screen.getByText(`${K}.balanceDue`)).toBeInTheDocument();
    expect(screen.getByText(/^Q\s*70\.00$/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${K}.settledAt`))).toBeInTheDocument();
    expect(screen.queryByText(`${K}.noClaims`)).not.toBeInTheDocument();
    // The SAVED settlement — the API's numbers — is what goes to the download.
    expect(screen.getByTestId('damage-report')).toHaveTextContent(/^270$/);
    expect(screen.queryByRole('button', { name: `${K}.refundAction` })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${K}.editReport` }));
    expect(onReport).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: `${K}.undo` }));
    expect(onUndo).toHaveBeenCalled();
  });

  it('a whole refund: "Devuelto", no report to download, and it can still become a damage report', () => {
    renderCard({ total: 200, held: 200, canSettle: true, settlement: clean() });
    expect(screen.getByText(`${K}.chipRefunded`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.noClaims`)).toBeInTheDocument();
    expect(screen.queryByText(`${K}.retained`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.balanceDue`)).not.toBeInTheDocument();
    expect(screen.queryByTestId('damage-report')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${K}.report` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${K}.undo` })).toBeInTheDocument();
  });

  it('a clean return with no deposit says "todo volvió en buen estado"', () => {
    renderCard({
      total: 0,
      held: 0,
      canSettle: true,
      settlement: { ...clean(), refundAmount: 0 },
    });
    expect(screen.getByText(`${K}.noClaimsNoDeposit`)).toBeInTheDocument();
  });

  it('a retention without a reason and a loss without a note render no empty sub-lines', () => {
    renderCard({
      total: 200,
      held: 200,
      canSettle: true,
      settlement: settlement({
        retainedReason: undefined,
        damages: [{ lineId: 31, productName: 'Mantel', quantity: 1, unitAmount: 50, amount: 50 }],
      }),
    });
    expect(screen.queryByText(`${K}.reason`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.note`)).not.toBeInTheDocument();
  });

  it('on a cancelled/rewound order the record can still be UNDONE, never edited', () => {
    renderCard({ total: 200, held: 200, canSettle: false, settlement: settlement() });
    expect(screen.getByRole('button', { name: `${K}.undo` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${K}.editReport` })).not.toBeInTheDocument();
  });

  describe('Cobro del depósito', () => {
    it('only exists when the API sent a collection (a deposit > 0)', () => {
      renderCard({ total: 200, held: 200, canSettle: true });
      expect(screen.queryByText(`${C}.title`)).not.toBeInTheDocument();
    });

    it('PENDING: "Pendiente de recibir" with "Marcar como recibido" and "Entregar sin depósito"', async () => {
      const { onCollection } = renderCard({
        total: 200,
        held: 200,
        canSettle: false,
        collection: { status: 'PENDING', canRecord: true },
      });
      expect(screen.getByText(`${C}.title`)).toBeInTheDocument();
      expect(screen.getByText(`${C}.pending`)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: `${C}.markReceived` }));
      expect(onCollection).toHaveBeenLastCalledWith('receive');
      await userEvent.click(screen.getByRole('button', { name: `${C}.waive` }));
      expect(onCollection).toHaveBeenLastCalledWith('waive');
      expect(screen.queryByRole('button', { name: `${C}.correct` })).not.toBeInTheDocument();
    });

    it('RECEIVED: when it was received, and "Corregir" while recordable', async () => {
      const { onCollection } = renderCard({
        total: 200,
        held: 200,
        canSettle: true,
        collection: { status: 'RECEIVED', at: '2026-08-01T15:00:00.000Z', canRecord: true },
      });
      expect(screen.getByText(`${C}.received`)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: `${C}.correct` }));
      expect(onCollection).toHaveBeenLastCalledWith('clear');
      // A received deposit is a real one: the happy path still gives it back.
      expect(screen.getByRole('button', { name: `${K}.refundAction` })).toBeInTheDocument();
    });

    it('RECEIVED without a date still says it was received', () => {
      renderCard({
        total: 200,
        held: 200,
        canSettle: true,
        collection: { status: 'RECEIVED', canRecord: true },
      });
      expect(screen.getByText(`${C}.receivedNoDate`)).toBeInTheDocument();
    });

    it('WAIVED: the reason as an INTERNAL note, held 0 ⇒ "Sin daños", never "Devolver depósito"', () => {
      renderCard({
        total: 200,
        held: 0,
        canSettle: true,
        collection: { status: 'WAIVED', reason: 'Familiar', at: '2026-08-01T15:00:00.000Z', canRecord: true },
      });
      expect(screen.getByText(`${C}.waived`)).toBeInTheDocument();
      expect(screen.getByText(`${C}.internalNote`)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `${K}.noDamageAction` })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: `${K}.refundAction` })).not.toBeInTheDocument();
      // The amount shown is the API's `held`, not the nominal total.
      expect(screen.getByText(/^Q\s*0\.00$/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `${C}.correct` })).toBeInTheDocument();
    });

    it('WAIVED without a reason still renders the line', () => {
      renderCard({
        total: 200,
        held: 0,
        canSettle: true,
        collection: { status: 'WAIVED', canRecord: true },
      });
      expect(screen.getByText(`${C}.waived`)).toBeInTheDocument();
    });

    it('a recorded damage report LOCKS it: no actions, and the hint says how to change it', () => {
      renderCard({
        total: 200,
        held: 200,
        canSettle: true,
        collection: { status: 'RECEIVED', at: '2026-08-01T15:00:00.000Z', canRecord: false },
        settlement: settlement(),
      });
      expect(screen.getByText(`${C}.lockedByReport`)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: `${C}.correct` })).not.toBeInTheDocument();
    });

    it('not recordable for another reason (cancelled): no actions and no report hint', () => {
      renderCard({
        total: 200,
        held: 200,
        canSettle: false,
        collection: { status: 'PENDING', canRecord: false },
      });
      expect(screen.queryByText(`${C}.lockedByReport`)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: `${C}.markReceived` })).not.toBeInTheDocument();
    });

    it('a non-admin sees the state but cannot record it', () => {
      renderCard(
        { total: 200, held: 200, canSettle: false, collection: { status: 'PENDING', canRecord: true } },
        false,
      );
      expect(screen.getByText(`${C}.pending`)).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});