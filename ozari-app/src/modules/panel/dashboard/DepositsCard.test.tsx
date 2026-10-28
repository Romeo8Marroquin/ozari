import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OrderListItem } from '../orders/order.types';
import type { DashboardDeposits } from './dashboard.types';
import DepositsCard from './DepositsCard';

const KEY = 'modules.panel.dashboard.deposits';

const item = (id: number, clientName: string): OrderListItem =>
  ({
    id,
    clientName,
    deliveryAt: new Date('2026-10-20T14:00:00').toISOString(),
    depositSettlementPending: true,
  }) as OrderListItem;

const deposits = (over: Partial<DashboardDeposits> = {}): DashboardDeposits => ({
  pending: { orders: 2, amount: 900, items: [item(12, 'María López'), item(14, 'Carlos Pérez')] },
  month: { settled: 3, refunded: 1200, retained: 150, replacements: 360, balanceDue: 80 },
  ...over,
});

const renderCard = (value: DashboardDeposits) => {
  const onOpen = vi.fn();
  render(<DepositsCard deposits={value} currencySymbol="Q" onOpen={onOpen} />);
  return { onOpen };
};

describe('DepositsCard', () => {
  it('lists the pending deposits as links to their orders, with the agenda’s chip', async () => {
    const { onOpen } = renderCard(deposits());
    expect(screen.getByText(`${KEY}.pending`)).toBeInTheDocument();
    expect(screen.getAllByText(`${KEY}.chip`)).toHaveLength(2);
    expect(screen.getByText('Carlos Pérez')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.openAria` })[0]);
    expect(onOpen).toHaveBeenCalledWith(12);
    // Every pending order is listed, so there is no "y N más".
    expect(screen.queryByText(`${KEY}.more`)).not.toBeInTheDocument();
  });

  it('says how many more there are beyond the five it lists', () => {
    renderCard(deposits({ pending: { orders: 7, amount: 3000, items: [item(12, 'María López')] } }));
    expect(screen.getByText(`${KEY}.more`)).toBeInTheDocument();
  });

  it('shows the month’s figures from the API, the owed balance in red', () => {
    renderCard(deposits());
    expect(screen.getByText(`${KEY}.month`)).toBeInTheDocument();
    expect(screen.getByText(/Q\s*1,200\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Q\s*150\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Q\s*360\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Q\s*80\.00/)).toHaveClass('text-red-600');
  });

  it('nothing owed keeps the balance neutral', () => {
    renderCard(
      deposits({ month: { settled: 1, refunded: 500, retained: 0, replacements: 0, balanceDue: 0 } }),
    );
    expect(screen.getAllByText(/Q\s*0\.00/).every((node) => !node.classList.contains('text-red-600'))).toBe(
      true,
    );
  });

  it('nothing pending but some recorded: says so, and still shows the month', () => {
    renderCard(deposits({ pending: { orders: 0, amount: 0, items: [] } }));
    expect(screen.getByText(`${KEY}.nonePending`)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(`${KEY}.month`)).toBeInTheDocument();
  });

  it('pending but nothing recorded this month: one line instead of a grid of zeros', () => {
    renderCard(
      deposits({ month: { settled: 0, refunded: 0, retained: 0, replacements: 0, balanceDue: 0 } }),
    );
    expect(screen.getByText(`${KEY}.monthNone`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.refunded`)).not.toBeInTheDocument();
  });

  it('nothing at all: ONE line, like the other empty sections', () => {
    renderCard({
      pending: { orders: 0, amount: 0, items: [] },
      month: { settled: 0, refunded: 0, retained: 0, replacements: 0, balanceDue: 0 },
    });
    expect(screen.getByText(`${KEY}.empty`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.month`)).not.toBeInTheDocument();
  });
});
