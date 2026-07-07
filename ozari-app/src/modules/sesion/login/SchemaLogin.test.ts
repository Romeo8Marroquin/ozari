import { describe, expect, it } from 'vitest';
import { loginRequiredPatterns, loginSchema } from './SchemaLogin';

const valid = { email: 'user@example.com', password: 'Passw0rd!123' };

describe('loginSchema', () => {
  it('accepts a valid email + policy-compliant password', () => {
    expect(loginSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a bad email or a weak password', () => {
    expect(loginSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
    expect(loginSchema.safeParse({ ...valid, password: 'weak' }).success).toBe(false);
  });

  it('marks both fields required', () => {
    expect(loginRequiredPatterns.some((p) => p.test('email'))).toBe(true);
    expect(loginRequiredPatterns.some((p) => p.test('password'))).toBe(true);
  });
});
