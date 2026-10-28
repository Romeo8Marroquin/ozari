import { describe, expect, it } from 'vitest';
import { squareOrderBalance, type OrderBalanceInput } from './orderBalance';

const base: OrderBalanceInput = { total: 23, advance: 0, paid: false };

describe('squareOrderBalance', () => {
  it('without a deposit, owes the rest of the service', () => {
    expect(squareOrderBalance({ ...base, advance: 5 })).toEqual({
      serviceDue: 18,
      advanceCredit: 0,
      depositDue: 0,
      depositOnHand: 0,
      depositCredit: 0,
      claims: 0,
      amount: 18,
      direction: 'collect',
    });
  });

  it('credits an anticipo larger than the cost instead of dropping it, paid or not', () => {
    expect(squareOrderBalance({ ...base, advance: 30 })).toMatchObject({
      serviceDue: 0,
      advanceCredit: 7,
      amount: 7,
      direction: 'refund',
    });
    expect(squareOrderBalance({ ...base, paid: true, advance: 30 })).toMatchObject({
      serviceDue: 0,
      advanceCredit: 7,
      direction: 'refund',
    });
    // The common shape: the client sent the deposit along with the anticipo (Q23 + Q80 = Q103).
    expect(
      squareOrderBalance({ ...base, advance: 103, deposit: { amount: 80, status: 'PENDING' } }),
    ).toMatchObject({ advanceCredit: 80, depositDue: 80, amount: 0, direction: 'none' });
  });

  it('reads the excess anticipo as the deposit once that deposit is in hand, never crediting it twice', () => {
    // Q103 sent, delivery confirmed "Depósito recibido": nothing moves yet.
    expect(
      squareOrderBalance({ ...base, advance: 103, deposit: { amount: 80, status: 'RECEIVED' } }),
    ).toMatchObject({ advanceCredit: 0, depositOnHand: 80, amount: 0, direction: 'none' });
    // Clean report: the Q80 goes back once, not Q160.
    expect(
      squareOrderBalance({ ...base, advance: 103, deposit: { amount: 80, status: 'RECEIVED' }, claimsTotal: 0 }),
    ).toMatchObject({ advanceCredit: 0, depositCredit: 80, amount: 80, direction: 'refund' });
    // Only what exceeds cost + deposit is a genuine saldo a favor (paid order, Q5,000 on Q2,893 + Q900).
    expect(
      squareOrderBalance({ total: 2893, advance: 5000, paid: true, deposit: { amount: 900, status: 'RECEIVED' } }),
    ).toMatchObject({ advanceCredit: 1207, depositOnHand: 900, amount: 1207, direction: 'refund' });
    // Waived ⇒ no deposit to absorb it: the whole excess is the client's.
    expect(
      squareOrderBalance({ ...base, advance: 103, deposit: { amount: 80, status: 'WAIVED' } }),
    ).toMatchObject({ advanceCredit: 80, amount: 80, direction: 'refund' });
  });

  it('adds a PENDING deposit to what is paid (the owner’s Q23 + Q80 = Q103)', () => {
    expect(squareOrderBalance({ ...base, deposit: { amount: 80, status: 'PENDING' } })).toMatchObject({
      serviceDue: 23,
      depositDue: 80,
      depositOnHand: 0,
      amount: 103,
      direction: 'collect',
    });
  });

  it('shows a RECEIVED deposit for information only, outside the sum', () => {
    expect(
      squareOrderBalance({ ...base, paid: true, deposit: { amount: 80, status: 'RECEIVED' } }),
    ).toMatchObject({ depositDue: 0, depositOnHand: 80, amount: 0, direction: 'none' });
  });

  it('treats a WAIVED deposit as no deposit at all', () => {
    expect(squareOrderBalance({ ...base, deposit: { amount: 80, status: 'WAIVED' } })).toMatchObject({
      depositDue: 0,
      depositOnHand: 0,
      amount: 23,
    });
    expect(
      squareOrderBalance({ ...base, paid: true, deposit: { amount: 80, status: 'WAIVED' }, claimsTotal: 120 }),
    ).toMatchObject({ depositCredit: 0, claims: 120, amount: 120, direction: 'collect' });
  });

  it('after a clean report on a paid order, refunds the whole deposit', () => {
    expect(
      squareOrderBalance({ ...base, paid: true, deposit: { amount: 80, status: 'RECEIVED' }, claimsTotal: 0 }),
    ).toMatchObject({ depositCredit: 80, claims: 0, amount: 80, direction: 'refund' });
  });

  it('after the report, nets the unpaid service and the damages against the deposit', () => {
    // Q8 service unpaid + Q140 damages − Q80 deposit = Q68 to collect (the owner's screenshot case).
    expect(
      squareOrderBalance({ total: 8, advance: 0, paid: false, deposit: { amount: 80, status: 'RECEIVED' }, claimsTotal: 140 }),
    ).toMatchObject({ serviceDue: 8, depositCredit: 80, claims: 140, amount: 68, direction: 'collect' });
    // Q8 unpaid + Q20 retained − Q80 = Q52 back to the client.
    expect(
      squareOrderBalance({ total: 8, advance: 0, paid: false, deposit: { amount: 80, status: 'RECEIVED' }, claimsTotal: 20 }),
    ).toMatchObject({ amount: 52, direction: 'refund' });
  });

  it('squares exactly to zero without a direction', () => {
    expect(
      squareOrderBalance({ ...base, paid: true, deposit: { amount: 80, status: 'RECEIVED' }, claimsTotal: 80 }),
    ).toMatchObject({ depositCredit: 80, amount: 0, direction: 'none' });
  });

  it('after the report, never credits a deposit that was not received, and stops asking for it whole', () => {
    // Pending: the Q80 was never handed over — the Q20 retention and Q90 replacement are billed whole.
    expect(
      squareOrderBalance({ ...base, paid: true, deposit: { amount: 80, status: 'PENDING' }, claimsTotal: 110 }),
    ).toMatchObject({ depositDue: 0, depositOnHand: 0, depositCredit: 0, amount: 110, direction: 'collect' });
    // A clean report on a deposit never received: nothing to give back.
    expect(
      squareOrderBalance({ ...base, paid: true, deposit: { amount: 80, status: 'WAIVED' }, claimsTotal: 0 }),
    ).toMatchObject({ depositCredit: 0, amount: 0, direction: 'none' });
  });

  it('rounds to cents', () => {
    expect(squareOrderBalance({ total: 0.3, advance: 0.1, paid: false }).amount).toBe(0.2);
  });
});
