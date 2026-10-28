import { SETTLEMENT_TEXT_MAX_LENGTH } from '@constants/Regex';
import { describe, expect, it } from 'vitest';
import {
  depositCollectionReasonError,
  depositCollectionSchema,
  toDepositCollectionBody,
} from './SchemaDepositCollection';

const KEY = 'modules.panel.orders.depositCollection.errors';

describe('depositCollectionSchema', () => {
  it('a received deposit needs no reason (and ignores one)', () => {
    expect(depositCollectionSchema.safeParse({ received: true, reason: '' }).success).toBe(true);
    expect(depositCollectionReasonError({ received: true, reason: 'x'.repeat(900) })).toBeUndefined();
  });

  it('handing the goods over WITHOUT it requires a reason — blank after trimming is none', () => {
    expect(depositCollectionReasonError({ received: false, reason: '   ' })).toBe(`${KEY}.reasonRequired`);
    expect(depositCollectionReasonError({ received: false, reason: 'Cliente de confianza' })).toBeUndefined();
  });

  it('caps the reason at the damage report ceiling, counted after trimming', () => {
    const atLimit = `  ${'a'.repeat(SETTLEMENT_TEXT_MAX_LENGTH)}  `;
    expect(depositCollectionReasonError({ received: false, reason: atLimit })).toBeUndefined();
    expect(
      depositCollectionReasonError({ received: false, reason: 'a'.repeat(SETTLEMENT_TEXT_MAX_LENGTH + 1) }),
    ).toBe(`${KEY}.reasonTooLong`);
  });

  it('rejects a non-boolean `received`', () => {
    expect(depositCollectionSchema.safeParse({ received: 'yes', reason: '' }).success).toBe(false);
  });
});

describe('toDepositCollectionBody', () => {
  it('a received deposit sends no reason', () => {
    expect(toDepositCollectionBody({ received: true, reason: 'sobra' })).toEqual({ received: true });
  });

  it('a waived deposit sends the reason, trimmed', () => {
    expect(toDepositCollectionBody({ received: false, reason: '  Familiar  ' })).toEqual({
      received: false,
      reason: 'Familiar',
    });
  });
});
