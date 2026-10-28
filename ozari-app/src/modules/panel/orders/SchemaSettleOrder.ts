import { PRODUCT_MAX_AMOUNT, SETTLEMENT_TEXT_MAX_LENGTH } from '@constants/Regex';
import { t } from 'i18next';
import { z } from 'zod';
import { formatMoney } from './orderEstimate';
import type {
  OrderDamage,
  OrderDepositSettlement,
  OrderDetail,
  OrderLine,
  SettleOrderBody,
} from './order.types';

const KEY = 'modules.panel.orders.settlement.errors';

/** Cents, the way the API stores (and truncates) money. */
const roundMoney = (value: number): number => Math.round(value * 100) / 100;

/**
 * The lines a lost/broken count can be recorded on: RENTAL lines that carry a replacement value —
 * exactly the API's rule (a damage on any other line is a `400`). A sold item never comes back, and
 * a rental without a replacement price has nothing to bill a missing unit at.
 */
export type DamageableLine = OrderLine & { replacementPrice: number };

export const damageableLines = (lines: readonly OrderLine[]): DamageableLine[] =>
  lines.filter(
    (line): line is DamageableLine => line.isRental && line.replacementPrice !== undefined,
  );

/**
 * The retained-amount text input → cents. BLANK is 0 (the deposit goes back whole — the common
 * case, so the field may stay empty); `null` when present but not a money value within the API's
 * global ceiling. Truncated to cents like the backend (`Math.trunc(x * 100) / 100`).
 */
export const parseRetainedAmount = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > PRODUCT_MAX_AMOUNT) return null;
  return Math.trunc(parsed * 100) / 100;
};

/** A damaged-units text input: BLANK is 0 (no damage); otherwise a whole number in `[0, max]`. */
export const parseDamagedQuantity = (value: string, max: number): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
};

export interface SettlementFormValues {
  retainedAmount: string;
  retainedReason: string;
  /** One row per {@link damageableLines} entry, in line order — `lineId` rides along, never shown. */
  damages: { lineId: number; quantity: string; note: string }[];
}

/** What the per-order rules are measured against. */
export interface SettlementSchemaContext {
  /** The order's NOMINAL deposit (`securityDeposit.total`) — the ceiling of what can be RETAINED,
   *  received or not: a retention not received is charged whole, "that part of the deposit"
   *  (owner, 2026-10-28). */
  depositTotal: number;
  currencySymbol: string;
  /** Each damageable line's ordered quantity — the ceiling of its lost/broken units. */
  maxByLine: ReadonlyMap<number, number>;
}

const tooLong = (value: string): boolean => value.trim().length > SETTLEMENT_TEXT_MAX_LENGTH;

/**
 * Mirrors `validateSettleOrder` (`ozari-api/.../settlement/settlement.validator.ts`) plus the two
 * per-order checks the API makes inside its transaction — retained ≤ the deposit, damaged units ≤
 * the line's quantity — which the form can state up front because the order is already on screen.
 * Built per order (the ceilings are the order's own numbers), and every rule lives in ONE
 * `superRefine`: the base shape is plain strings that always pass, so the cross-field rules (the
 * reason is required iff something is retained) speak from the first keystroke.
 */
export function createSettlementSchema({
  depositTotal,
  currencySymbol,
  maxByLine,
}: SettlementSchemaContext) {
  return z
    .object({
      retainedAmount: z.string(),
      retainedReason: z.string(),
      damages: z.array(z.object({ lineId: z.number(), quantity: z.string(), note: z.string() })),
    })
    .superRefine((data, ctx) => {
      const retained = parseRetainedAmount(data.retainedAmount);
      if (retained === null) {
        ctx.addIssue({ code: 'custom', path: ['retainedAmount'], message: t(`${KEY}.invalidRetained`) });
      } else if (retained > depositTotal) {
        ctx.addIssue({
          code: 'custom',
          path: ['retainedAmount'],
          message: t(`${KEY}.retainedAboveDeposit`, {
            deposit: formatMoney(currencySymbol, depositTotal),
          }),
        });
      }
      if (tooLong(data.retainedReason)) {
        ctx.addIssue({ code: 'custom', path: ['retainedReason'], message: t(`${KEY}.textTooLong`) });
      } else if (retained !== null && retained > 0 && data.retainedReason.trim() === '') {
        // Keeping a client's money without saying why is the dispute the reason exists to prevent.
        ctx.addIssue({ code: 'custom', path: ['retainedReason'], message: t(`${KEY}.reasonRequired`) });
      }
      data.damages.forEach((row, index) => {
        const max = maxByLine.get(row.lineId) ?? 0;
        if (parseDamagedQuantity(row.quantity, max) === null) {
          ctx.addIssue({
            code: 'custom',
            path: ['damages', index, 'quantity'],
            message: t(`${KEY}.invalidDamaged`, { max }),
          });
        }
        if (tooLong(row.note)) {
          ctx.addIssue({ code: 'custom', path: ['damages', index, 'note'], message: t(`${KEY}.textTooLong`) });
        }
      });
    });
}

/**
 * The form's starting values: the RECORDED settlement when there is one (editing corrects it —
 * the endpoint is declarative), else a blank form, which means "the deposit goes back whole".
 */
export function settlementToFormValues(order: OrderDetail): SettlementFormValues {
  const settlement = order.securityDeposit?.settlement;
  return {
    retainedAmount:
      settlement !== undefined && settlement.retainedAmount > 0 ? String(settlement.retainedAmount) : '',
    retainedReason: settlement?.retainedReason ?? '',
    damages: damageableLines(order.lines).map((line) => ({
      lineId: line.id,
      quantity: line.damagedQuantity > 0 ? String(line.damagedQuantity) : '',
      note: line.damageNote ?? '',
    })),
  };
}

/**
 * The validated values → the `PUT /orders/:id/settlement` body: the settlement's FINAL state. A line
 * with 0 lost/broken units is simply left out (the API reads an omitted line as "no damage"), the
 * reason travels only with something retained, and blank notes are dropped.
 */
export function toSettleOrderBody(values: SettlementFormValues): SettleOrderBody {
  const retainedAmount = parseRetainedAmount(values.retainedAmount) ?? 0;
  const reason = values.retainedReason.trim();
  return {
    retainedAmount,
    ...(retainedAmount > 0 && reason !== '' && { retainedReason: reason }),
    damages: values.damages.flatMap((row) => {
      const quantity = parseDamagedQuantity(row.quantity, Number.MAX_SAFE_INTEGER) ?? 0;
      if (quantity < 1) return [];
      const note = row.note.trim();
      return [{ lineId: row.lineId, quantity, ...(note !== '' && { note }) }];
    }),
  };
}

export interface SettlementPreview {
  retainedAmount: number;
  damagesTotal: number;
  claimsTotal: number;
  refundAmount: number;
  balanceDue: number;
}

/**
 * A LIVE ESTIMATE of the outcome while the admin types — the API's own formula (claims = retained +
 * lost/broken units at their replacement value; the HELD deposit — `securityDeposit.held`, 0 unless
 * it was received — covers what it can, the rest of it is refunded, and what it cannot cover is
 * owed). Labelled as an estimate on screen: the saved
 * settlement's numbers come back from the API, and the detail page shows only those. A value that is
 * not valid yet counts as 0, so the preview never shows a number built from a typo.
 */
export function previewSettlement(
  held: number,
  values: SettlementFormValues,
  lines: ReadonlyMap<number, { quantity: number; unitAmount: number }>,
): SettlementPreview {
  const retainedAmount = parseRetainedAmount(values.retainedAmount) ?? 0;
  const damagesTotal = roundMoney(
    values.damages.reduce((sum, row) => {
      const line = lines.get(row.lineId);
      if (!line) return sum;
      const quantity = parseDamagedQuantity(row.quantity, line.quantity) ?? 0;
      return sum + quantity * line.unitAmount;
    }, 0),
  );
  const claimsTotal = roundMoney(retainedAmount + damagesTotal);
  const applied = Math.min(held, claimsTotal);
  return {
    retainedAmount,
    damagesTotal,
    claimsTotal,
    refundAmount: roundMoney(held - applied),
    balanceDue: roundMoney(Math.max(0, claimsTotal - held)),
  };
}

/**
 * The CURRENT form values as an unsaved {@link OrderDepositSettlement} — what the "Reportar daños"
 * page hands the damage-report document so the admin can give it to the client BEFORE saving.
 *
 * Same formula as {@link previewSettlement} (it is built on it), shaped like the API's record: each
 * lost/broken line priced at its replacement snapshot (`unitAmount`), `amount` rounded to cents, the
 * note trimmed (blank ⇒ absent), the reason only alongside something retained, and `settledAt` = the
 * moment the page was opened. A value that is not valid counts as 0 here, exactly like the preview —
 * the page additionally offers the report only while the whole form validates, so a typo never prints.
 * The deposit is `held` — the API's figure, 0 unless the deposit was actually RECEIVED (owner,
 * 2026-10-28) — never the nominal total: only money in hand is refunded or applied, so a deposit
 * not received leaves every claim owed whole. Once saved, the document is built from the API's own
 * numbers instead.
 */
export function buildUnsavedSettlement(
  order: OrderDetail,
  values: SettlementFormValues,
  now: Date,
): OrderDepositSettlement {
  const held = order.securityDeposit?.held ?? 0;
  const lines = damageableLines(order.lines);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const damages = values.damages.flatMap((row): OrderDamage[] => {
    const line = byId.get(row.lineId);
    if (!line) return [];
    const quantity = parseDamagedQuantity(row.quantity, line.quantity) ?? 0;
    if (quantity < 1) return [];
    const note = row.note.trim();
    return [
      {
        lineId: line.id,
        productName: line.productName,
        quantity,
        unitAmount: line.replacementPrice,
        amount: roundMoney(quantity * line.replacementPrice),
        ...(note !== '' && { note }),
      },
    ];
  });
  const preview = previewSettlement(
    held,
    values,
    new Map(lines.map((line) => [line.id, { quantity: line.quantity, unitAmount: line.replacementPrice }])),
  );
  const reason = values.retainedReason.trim();
  return {
    settledAt: now.toISOString(),
    retainedAmount: preview.retainedAmount,
    ...(preview.retainedAmount > 0 && reason !== '' && { retainedReason: reason }),
    damages,
    damagesTotal: preview.damagesTotal,
    claimsTotal: preview.claimsTotal,
    appliedFromDeposit: roundMoney(Math.min(held, preview.claimsTotal)),
    refundAmount: preview.refundAmount,
    balanceDue: preview.balanceDue,
  };
}
