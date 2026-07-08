import { describe, expect, it } from 'vitest';
import {
  resetPasswordDefaultValues,
  resetPasswordSchema,
  resetRequiredPatterns,
} from './SchemaResetPassword';

const VALID = 'Passw0rd!123';

describe('resetPasswordSchema', () => {
  it('accepts a valid, matching password', () => {
    expect(resetPasswordSchema.safeParse({ password: VALID, confirmPassword: VALID }).success).toBe(
      true,
    );
  });

  it('rejects a weak password', () => {
    expect(
      resetPasswordSchema.safeParse({ password: 'weak', confirmPassword: 'weak' }).success,
    ).toBe(false);
  });

  it('rejects mismatched passwords on the confirm field', () => {
    const result = resetPasswordSchema.safeParse({
      password: VALID,
      confirmPassword: 'Different!123',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['confirmPassword']);
    }
  });

  it('rejects an empty confirmation', () => {
    expect(
      resetPasswordSchema.safeParse({ password: VALID, confirmPassword: '' }).success,
    ).toBe(false);
  });

  it('exposes empty defaults and required patterns', () => {
    expect(resetPasswordDefaultValues).toEqual({ password: '', confirmPassword: '' });
    expect(resetRequiredPatterns.some((pattern) => pattern.test('password'))).toBe(true);
    expect(resetRequiredPatterns.some((pattern) => pattern.test('confirmPassword'))).toBe(true);
  });
});
