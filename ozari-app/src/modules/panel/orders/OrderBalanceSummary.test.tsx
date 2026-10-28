import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OrderBalanceSummary from './OrderBalanceSummary';
import type { OrderDetail, OrderSecurityDeposit } from './order.types';

const KEY = 'modules.panel.orders.detail.money.balance';

const order = (overrides: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: 1,
    totalAmount: 1000,
    currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
    ...overrides,
  }) as OrderDetail;

const deposit = (overrides: Partial<OrderSecurityDeposit> = {}): OrderSecurityDeposit => ({
  total: 300,
  held: 300,
  canSettle: false,
  collection: { status: 'PENDING', canRecord: true },
  ...overrides,
});

const report = (claimsTotal: number) =>
  ({
    settledAt: '2026-08-01T15:00:00.000Z',
    retainedAmount: 0,
    damages: [],
    damagesTotal: claimsTotal,
    claimsTotal,
    appliedFromDeposit: 0,
    refundAmount: 0,
    balanceDue: 0,
  }) satisfies OrderSecurityDeposit['settlement'];

/** The row whose label is `key` → its amount cell's text. */
const amountOf = (key: string): string | null =>
  screen.getByText(`${KEY}.${key}`).nextElementSibling?.textContent ?? null;

describe('OrderBalanceSummary', () => {
  it('nothing paid, no anticipo, no deposit: just the amount to pay — no lone "Saldo" row', () => {
    render(<OrderBalanceSummary order={order()} />);
    expect(amountOf('collect')).toMatch(/Q\s*1,?000\.00/);
    expect(screen.queryByText(`${KEY}.serviceDue`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.advance`)).not.toBeInTheDocument();
  });

  it('an anticipo is subtracted and leaves the "Saldo del servicio"', () => {
    render(<OrderBalanceSummary order={order({ depositAmount: 400 })} />);
    expect(amountOf('advance')).toMatch(/^−Q\s*400\.00$/);
    expect(amountOf('serviceDue')).toMatch(/Q\s*600\.00/);
    expect(amountOf('collect')).toMatch(/Q\s*600\.00/);
  });

  it('an anticipo ABOVE the cost (the deposit sent with it) is credited, so the card adds up', () => {
    render(
      <OrderBalanceSummary order={order({ depositAmount: 1300, securityDeposit: deposit() })} />,
    );
    expect(amountOf('advance')).toMatch(/^−Q\s*1,?300\.00$/);
    expect(amountOf('serviceDue')).toMatch(/Q\s*0\.00/);
    expect(amountOf('advanceCredit')).toMatch(/^−Q\s*300\.00$/);
    expect(amountOf('depositDue')).toMatch(/^\+Q\s*300\.00$/);
    // 0 − 300 + 300: the deposit it covered — nothing left to change hands.
    expect(amountOf('none')).toMatch(/Q\s*0\.00/);
  });

  it('an over-paid anticipo with no deposit to cover is money going BACK', () => {
    render(<OrderBalanceSummary order={order({ depositAmount: 1200 })} />);
    expect(amountOf('advanceCredit')).toMatch(/^−Q\s*200\.00$/);
    expect(amountOf('refund')).toMatch(/Q\s*200\.00/);
  });

  it('a pending deposit is ADDED to what changes hands now, as its own refundable row', () => {
    render(<OrderBalanceSummary order={order({ securityDeposit: deposit() })} />);
    expect(amountOf('serviceDue')).toMatch(/Q\s*1,?000\.00/);
    expect(amountOf('depositDue')).toMatch(/^\+Q\s*300\.00$/);
    expect(amountOf('collect')).toMatch(/Q\s*1,?300\.00/);
  });

  it('paid + deposit received: "Sin saldo pendiente", the deposit in hand stated outside the sum', () => {
    render(
      <OrderBalanceSummary
        order={order({
          depositAmount: 400,
          paidAt: '2026-08-01T15:00:00.000Z',
          securityDeposit: deposit({ collection: { status: 'RECEIVED', canRecord: true } }),
        })}
      />,
    );
    expect(amountOf('none')).toMatch(/Q\s*0\.00/);
    expect(amountOf('depositOnHand')).toMatch(/Q\s*300\.00/);
    // Paid: the anticipo no longer explains anything.
    expect(screen.queryByText(`${KEY}.advance`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.serviceDue`)).not.toBeInTheDocument();
  });

  it('after a clean report the deposit is credited back: the INVERTED "Monto a devolver"', () => {
    render(
      <OrderBalanceSummary
        order={order({
          paidAt: '2026-08-01T15:00:00.000Z',
          securityDeposit: deposit({
            collection: { status: 'RECEIVED', canRecord: false },
            settlement: report(0),
          }),
        })}
      />,
    );
    expect(amountOf('depositCredit')).toMatch(/^−Q\s*300\.00$/);
    expect(amountOf('serviceDue')).toMatch(/Q\s*0\.00/);
    const refund = screen.getByText(`${KEY}.refund`).parentElement;
    expect(refund).toHaveClass('bg-charcoal', 'text-white');
    expect(refund).toHaveTextContent(/Q\s*300\.00/);
    expect(screen.queryByText(`${KEY}.depositOnHand`)).not.toBeInTheDocument();
  });

  it('damages beyond the deposit: claims (+), credit (−), a balance to collect', () => {
    render(
      <OrderBalanceSummary
        order={order({
          paidAt: '2026-08-01T15:00:00.000Z',
          securityDeposit: deposit({
            collection: { status: 'RECEIVED', canRecord: false },
            settlement: report(450),
          }),
        })}
      />,
    );
    expect(amountOf('claims')).toMatch(/^\+Q\s*450\.00$/);
    expect(amountOf('depositCredit')).toMatch(/^−Q\s*300\.00$/);
    const collect = screen.getByText(`${KEY}.collect`).parentElement;
    expect(collect).toHaveClass('bg-charcoal/[0.05]');
    expect(collect).toHaveTextContent(/Q\s*150\.00/);
  });

  it('WAIVED: nothing due, nothing credited — damages are billed whole', () => {
    render(
      <OrderBalanceSummary
        order={order({
          paidAt: '2026-08-01T15:00:00.000Z',
          securityDeposit: deposit({
            held: 0,
            collection: { status: 'WAIVED', reason: 'Familiar', canRecord: false },
            settlement: report(120),
          }),
        })}
      />,
    );
    expect(screen.queryByText(`${KEY}.depositCredit`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.depositDue`)).not.toBeInTheDocument();
    expect(amountOf('collect')).toMatch(/Q\s*120\.00/);
  });

  it('a deposit block without a collection (replacement values only) adds nothing', () => {
    render(
      <OrderBalanceSummary
        order={order({
          paidAt: '2026-08-01T15:00:00.000Z',
          securityDeposit: { total: 0, held: 0, canSettle: true },
        })}
      />,
    );
    expect(amountOf('none')).toMatch(/Q\s*0\.00/);
    expect(screen.queryByText(`${KEY}.depositDue`)).not.toBeInTheDocument();
  });
});
