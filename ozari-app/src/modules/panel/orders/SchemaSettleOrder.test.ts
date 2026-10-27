import { describe, expect, it } from 'vitest';
import type { OrderDetail, OrderLine } from './order.types';
import {
  createSettlementSchema,
  damageableLines,
  parseDamagedQuantity,
  parseRetainedAmount,
  previewSettlement,
  settlementToFormValues,
  toSettleOrderBody,
  type SettlementFormValues,
} from './SchemaSettleOrder';

const E = 'modules.panel.orders.settlement.errors';

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: 31,
  productId: 3,
  productName: 'Mantel blanco',
  isRental: true,
  quantity: 10,
  unitaryPrice: 15,
  parcialPrice: 150,
  securityDeposit: 20,
  replacementPrice: 120,
  damagedQuantity: 0,
  ...over,
});

const schema = createSettlementSchema({
  depositTotal: 200,
  currencySymbol: 'Q',
  maxByLine: new Map([[31, 10]]),
});

const values = (over: Partial<SettlementFormValues> = {}): SettlementFormValues => ({
  retainedAmount: '',
  retainedReason: '',
  damages: [{ lineId: 31, quantity: '', note: '' }],
  ...over,
});

const issues = (data: SettlementFormValues): { path: string; message: string }[] => {
  const result = schema.safeParse(data);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
};

describe('parsers', () => {
  it('parseRetainedAmount: blank is 0, money is truncated to cents, junk/out-of-range is null', () => {
    expect(parseRetainedAmount('')).toBe(0);
    expect(parseRetainedAmount('  ')).toBe(0);
    expect(parseRetainedAmount('50.559')).toBe(50.55);
    expect(parseRetainedAmount('abc')).toBeNull();
    expect(parseRetainedAmount('-1')).toBeNull();
    expect(parseRetainedAmount('1000001')).toBeNull();
  });

  it('parseDamagedQuantity: blank is 0, a whole number within [0, max], else null', () => {
    expect(parseDamagedQuantity('', 5)).toBe(0);
    expect(parseDamagedQuantity('5', 5)).toBe(5);
    expect(parseDamagedQuantity('6', 5)).toBeNull();
    expect(parseDamagedQuantity('1.5', 5)).toBeNull();
  });
});

describe('damageableLines', () => {
  it('keeps rental lines with a replacement value — the only ones the API bills a loss on', () => {
    const lines = [
      line(),
      line({ id: 32, isRental: false, replacementPrice: undefined }),
      line({ id: 33, replacementPrice: undefined }),
    ];
    expect(damageableLines(lines).map((row) => row.id)).toEqual([31]);
  });
});

describe('createSettlementSchema (mirrors validateSettleOrder + the per-order ceilings)', () => {
  it('accepts a whole refund (everything blank)', () => {
    expect(issues(values())).toEqual([]);
  });

  it('rejects a malformed retained amount, and one above the deposit', () => {
    expect(issues(values({ retainedAmount: '-5' }))).toEqual([
      { path: 'retainedAmount', message: `${E}.invalidRetained` },
    ]);
    expect(issues(values({ retainedAmount: '200.01', retainedReason: 'x' }))).toEqual([
      { path: 'retainedAmount', message: `${E}.retainedAboveDeposit` },
    ]);
    // Exactly the deposit is fine.
    expect(issues(values({ retainedAmount: '200', retainedReason: 'Mantel quemado' }))).toEqual([]);
  });

  it('requires the reason exactly when something is retained', () => {
    expect(issues(values({ retainedAmount: '50' }))).toEqual([
      { path: 'retainedReason', message: `${E}.reasonRequired` },
    ]);
    expect(issues(values({ retainedAmount: '50', retainedReason: '   ' }))).toEqual([
      { path: 'retainedReason', message: `${E}.reasonRequired` },
    ]);
    // Nothing retained ⇒ no reason needed (a stray one is simply dropped from the body).
    expect(issues(values({ retainedAmount: '0' }))).toEqual([]);
    // A malformed amount reports itself only — no bogus "reason required" beside it.
    expect(issues(values({ retainedAmount: 'abc' })).map((issue) => issue.path)).toEqual([
      'retainedAmount',
    ]);
  });

  it('bounds the reason and each note at 500 characters (after trimming)', () => {
    const long = 'a'.repeat(501);
    expect(issues(values({ retainedAmount: '5', retainedReason: long }))).toEqual([
      { path: 'retainedReason', message: `${E}.textTooLong` },
    ]);
    expect(issues(values({ retainedAmount: '5', retainedReason: ` ${'a'.repeat(500)} ` }))).toEqual([]);
    expect(issues(values({ damages: [{ lineId: 31, quantity: '1', note: long }] }))).toEqual([
      { path: 'damages.0.note', message: `${E}.textTooLong` },
    ]);
  });

  it('caps the lost/broken units at the line\'s own quantity (unknown line ⇒ 0)', () => {
    expect(issues(values({ damages: [{ lineId: 31, quantity: '10', note: '' }] }))).toEqual([]);
    expect(issues(values({ damages: [{ lineId: 31, quantity: '11', note: '' }] }))).toEqual([
      { path: 'damages.0.quantity', message: `${E}.invalidDamaged` },
    ]);
    expect(issues(values({ damages: [{ lineId: 99, quantity: '1', note: '' }] }))).toEqual([
      { path: 'damages.0.quantity', message: `${E}.invalidDamaged` },
    ]);
  });
});

describe('settlementToFormValues', () => {
  const order = (over: Partial<OrderDetail> = {}): OrderDetail =>
    ({
      lines: [line(), line({ id: 32, isRental: false, replacementPrice: undefined })],
      securityDeposit: { total: 200, canSettle: true },
      ...over,
    }) as OrderDetail;

  it('opens blank (= the deposit goes back whole) when nothing is recorded', () => {
    expect(settlementToFormValues(order())).toEqual(values());
  });

  it('prefills the RECORDED settlement so an edit re-sends it whole', () => {
    const settled = order({
      lines: [line({ damagedQuantity: 2, damageNote: 'Quemados' })],
      securityDeposit: {
        total: 200,
        canSettle: true,
        settlement: {
          settledAt: '2026-08-03T10:00:00.000Z',
          retainedAmount: 30,
          retainedReason: 'Manchas',
          damages: [],
          damagesTotal: 240,
          claimsTotal: 270,
          appliedFromDeposit: 200,
          refundAmount: 0,
          balanceDue: 70,
        },
      },
    });
    expect(settlementToFormValues(settled)).toEqual({
      retainedAmount: '30',
      retainedReason: 'Manchas',
      damages: [{ lineId: 31, quantity: '2', note: 'Quemados' }],
    });
  });

  it('a recorded zero retention opens blank, and a missing reason opens empty', () => {
    const settled = order({
      securityDeposit: {
        total: 200,
        canSettle: true,
        settlement: {
          settledAt: '2026-08-03T10:00:00.000Z',
          retainedAmount: 0,
          damages: [],
          damagesTotal: 0,
          claimsTotal: 0,
          appliedFromDeposit: 0,
          refundAmount: 200,
          balanceDue: 0,
        },
      },
    });
    expect(settlementToFormValues(settled)).toMatchObject({ retainedAmount: '', retainedReason: '' });
  });
});

describe('toSettleOrderBody', () => {
  it('sends the final state: cents, the reason only with a retention, damaged lines only', () => {
    expect(
      toSettleOrderBody({
        retainedAmount: '50.559',
        retainedReason: '  Mantel manchado  ',
        damages: [
          { lineId: 31, quantity: '2', note: '  Se quemaron ' },
          { lineId: 32, quantity: '', note: 'ignorada' },
          { lineId: 33, quantity: '1', note: '   ' },
        ],
      }),
    ).toEqual({
      retainedAmount: 50.55,
      retainedReason: 'Mantel manchado',
      damages: [
        { lineId: 31, quantity: 2, note: 'Se quemaron' },
        { lineId: 33, quantity: 1 },
      ],
    });
  });

  it('a whole refund is retainedAmount 0, no reason, no damages', () => {
    expect(toSettleOrderBody(values({ retainedReason: 'sobra' }))).toEqual({
      retainedAmount: 0,
      damages: [],
    });
    // Defensive: an unparseable leftover degrades to "nothing", never to a NaN in the body.
    expect(
      toSettleOrderBody(values({ retainedAmount: 'x', damages: [{ lineId: 31, quantity: 'x', note: '' }] })),
    ).toEqual({ retainedAmount: 0, damages: [] });
  });
});

describe('previewSettlement (the API formula, as a labelled estimate)', () => {
  const lines = new Map([[31, { quantity: 10, unitAmount: 120 }]]);

  it('refunds what the claims leave of the deposit', () => {
    expect(previewSettlement(200, values({ retainedAmount: '50' }), lines)).toEqual({
      retainedAmount: 50,
      damagesTotal: 0,
      claimsTotal: 50,
      refundAmount: 150,
      balanceDue: 0,
    });
  });

  it('bills what the deposit cannot cover', () => {
    expect(
      previewSettlement(
        200,
        values({ retainedAmount: '30', damages: [{ lineId: 31, quantity: '2', note: '' }] }),
        lines,
      ),
    ).toEqual({ retainedAmount: 30, damagesTotal: 240, claimsTotal: 270, refundAmount: 0, balanceDue: 70 });
  });

  it('counts not-yet-valid input (and unknown lines) as 0 — never a number built from a typo', () => {
    expect(
      previewSettlement(
        200,
        values({
          retainedAmount: 'abc',
          damages: [
            { lineId: 31, quantity: '99', note: '' },
            { lineId: 77, quantity: '1', note: '' },
          ],
        }),
        lines,
      ),
    ).toEqual({ retainedAmount: 0, damagesTotal: 0, claimsTotal: 0, refundAmount: 200, balanceDue: 0 });
  });
});
