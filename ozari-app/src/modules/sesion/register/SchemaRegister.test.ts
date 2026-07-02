import { describe, expect, it } from 'vitest';
import { registerSchema } from './SchemaRegister';

const valid = {
  fullName: 'Ana María López',
  email: 'ana@example.com',
  password: 'Passw0rd!123',
  confirmPassword: 'Passw0rd!123',
  termsAccepted: true,
};

describe('registerSchema', () => {
  it('accepts a fully valid registration', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects when the passwords do not match', () => {
    const result = registerSchema.safeParse({ ...valid, confirmPassword: 'Different1!23' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('confirmPassword'))).toBe(true);
    }
  });

  it('requires the terms to be accepted', () => {
    expect(registerSchema.safeParse({ ...valid, termsAccepted: false }).success).toBe(false);
  });

  it('rejects an invalid full name', () => {
    expect(registerSchema.safeParse({ ...valid, fullName: 'A' }).success).toBe(false);
  });
});
