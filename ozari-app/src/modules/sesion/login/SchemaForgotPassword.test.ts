import { describe, expect, it } from 'vitest';
import {
  forgotPasswordDefaultValues,
  forgotPasswordSchema,
  forgotRequiredPatterns,
} from './SchemaForgotPassword';

describe('forgotPasswordSchema', () => {
  it('accepts a valid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'ana@example.com' }).success).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('exposes empty defaults and required patterns', () => {
    expect(forgotPasswordDefaultValues).toEqual({ email: '' });
    expect(forgotRequiredPatterns.some((pattern) => pattern.test('email'))).toBe(true);
  });
});
