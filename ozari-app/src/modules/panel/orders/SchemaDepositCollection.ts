import { SETTLEMENT_TEXT_MAX_LENGTH } from '@constants/Regex';
import { t } from 'i18next';
import { z } from 'zod';
import type { DepositCollectionBody } from './order.types';

const KEY = 'modules.panel.orders.depositCollection.errors';

export interface DepositCollectionValues {
  received: boolean;
  reason: string;
}

/**
 * Mirrors the API's deposit-collection validator (`PUT /orders/:id/deposit-collection` and the
 * advance body's `depositCollection`): `received` is a real boolean, and handing the goods over
 * WITHOUT the deposit needs a reason of 1–500 characters (counted after trimming, the same ceiling
 * as the damage report's texts — `SETTLEMENT_TEXT_MAX_LENGTH`). A received deposit ignores the reason.
 */
export const depositCollectionSchema = z
  .object({ received: z.boolean(), reason: z.string() })
  .superRefine((data, ctx) => {
    if (data.received) return;
    const reason = data.reason.trim();
    if (reason === '') {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: t(`${KEY}.reasonRequired`) });
    } else if (reason.length > SETTLEMENT_TEXT_MAX_LENGTH) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: t(`${KEY}.reasonTooLong`) });
    }
  });

/** The reason's error message for these values, or `undefined` when they are valid. */
export function depositCollectionReasonError(values: DepositCollectionValues): string | undefined {
  const result = depositCollectionSchema.safeParse(values);
  // Only the reason can fail, so a failure always carries exactly that one issue.
  return result.success ? undefined : result.error.issues[0].message;
}

/** The validated values → the body: the reason travels only with a waived deposit, trimmed. */
export function toDepositCollectionBody(values: DepositCollectionValues): DepositCollectionBody {
  return values.received ? { received: true } : { received: false, reason: values.reason.trim() };
}
