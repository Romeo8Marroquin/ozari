import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
  retainedReason: 'Manchas de vino',
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

const renderCard = (deposit: OrderSecurityDeposit, isAdmin = true) => {
  const onSettle = vi.fn();
  const onUndo = vi.fn();
  render(
    <OrderDepositCard
      order={order}
      deposit={deposit}
      isAdmin={isAdmin}
      onSettle={onSettle}
      onUndo={onUndo}
    />,
  );
  return { onSettle, onUndo };
};

describe('OrderDepositCard', () => {
  it('before delivery: the total and "se liquida después de la entrega", nothing to press', () => {
    renderCard({ total: 200, canSettle: false });
    expect(screen.getByRole('heading', { name: `${K}.title` })).toBeInTheDocument();
    expect(screen.getByText(/Q\s*200\.00/)).toBeInTheDocument();
    // Collected ON TOP of the order — said where the amount is.
    expect(screen.getByText(`${K}.totalNote`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.notYet`)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.chipPending`)).not.toBeInTheDocument();
  });

  it('delivered, not settled: "por liquidar" and the primary "Liquidar garantía" (Admin)', async () => {
    const { onSettle } = renderCard({ total: 200, canSettle: true });
    expect(screen.getByText(`${K}.chipPending`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.due`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${K}.settle` }));
    expect(onSettle).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: `${K}.undo` })).not.toBeInTheDocument();
  });

  it('a non-admin sees the state but no settlement actions (the endpoints are Admin-only)', () => {
    renderCard({ total: 200, canSettle: true, settlement: settlement() }, false);
    expect(screen.getByText(`${K}.chipSettled`)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('settled: renders the API\'s breakdown verbatim — retained, each loss, refund, balance', async () => {
    const { onSettle, onUndo } = renderCard({ total: 200, canSettle: true, settlement: settlement() });
    expect(screen.getByText(`${K}.chipSettled`)).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole('button', { name: `${K}.edit` }));
    expect(onSettle).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: `${K}.undo` }));
    expect(onUndo).toHaveBeenCalled();
  });

  it('a whole refund says so, and omits every empty line', () => {
    renderCard({
      total: 200,
      canSettle: true,
      settlement: settlement({
        retainedAmount: 0,
        retainedReason: undefined,
        damages: [],
        damagesTotal: 0,
        claimsTotal: 0,
        appliedFromDeposit: 0,
        refundAmount: 200,
        balanceDue: 0,
      }),
    });
    expect(screen.getByText(`${K}.noClaims`)).toBeInTheDocument();
    expect(screen.queryByText(`${K}.retained`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.balanceDue`)).not.toBeInTheDocument();
  });

  it('a retention without a reason and a loss without a note render no empty sub-lines', () => {
    renderCard({
      total: 200,
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
    renderCard({ total: 200, canSettle: false, settlement: settlement() });
    expect(screen.getByRole('button', { name: `${K}.undo` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${K}.edit` })).not.toBeInTheDocument();
  });
});
