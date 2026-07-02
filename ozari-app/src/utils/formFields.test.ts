import { describe, expect, it } from 'vitest';
import { emailField, fullNameField, passwordField } from './formFields';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown): boolean =>
  schema.safeParse(v).success;

describe('emailField', () => {
  it('accepts a valid address', () => {
    expect(ok(emailField, 'user@example.com')).toBe(true);
  });

  it('rejects empty, malformed, and over-length addresses', () => {
    expect(ok(emailField, '')).toBe(false);
    expect(ok(emailField, 'not-an-email')).toBe(false);
    expect(ok(emailField, `${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('passwordField (12–128, upper+lower+digit+allowed symbol, nothing else)', () => {
  it('accepts a policy-compliant password', () => {
    expect(ok(passwordField, 'Passw0rd!123')).toBe(true);
  });

  it.each([
    ['too short', 'Ab1!ef'],
    ['no uppercase', 'passw0rd!123'],
    ['no lowercase', 'PASSW0RD!123'],
    ['no digit', 'Password!!!!'],
    ['no symbol', 'Password12345'],
    ['disallowed char (space)', 'Passw0rd! 123'],
    ['disallowed symbol', 'Passw0rd~123('],
  ])('rejects: %s', (_label, value) => {
    expect(ok(passwordField, value)).toBe(false);
  });
});

describe('fullNameField', () => {
  it('accepts letters, accents and spaces', () => {
    expect(ok(fullNameField, 'Ana María López')).toBe(true);
    expect(ok(fullNameField, "O'Brien-Núñez")).toBe(true);
  });

  it('rejects empty and clearly invalid characters', () => {
    expect(ok(fullNameField, '')).toBe(false);
    expect(ok(fullNameField, 'Juan@Pérez')).toBe(false);
  });
});
