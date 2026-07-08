import { describe, expect, it } from 'vitest';
import { mfaLoginDefaultValues, recoveryLoginSchema, totpLoginSchema } from './SchemaMfaLogin';

const KEY = 'modules.sesion.login.mfa.errors';

describe('totpLoginSchema', () => {
  it('accepts exactly six digits', () => {
    expect(totpLoginSchema.safeParse({ code: '123456' }).success).toBe(true);
  });

  it.each([
    ['too short', '12345'],
    ['too long', '1234567'],
    ['letters', 'abcdef'],
    ['empty', ''],
  ])('rejects a %s TOTP with the length hint', (_label, code) => {
    const result = totpLoginSchema.safeParse({ code });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe(`${KEY}.codeLength`);
  });
});

describe('recoveryLoginSchema', () => {
  it('accepts a 16-char base32 recovery code', () => {
    expect(recoveryLoginSchema.safeParse({ code: 'ABCD2345EFGH6723' }).success).toBe(true);
  });

  it.each([
    ['too short', 'ABCD2345'],
    ['excluded chars (0/1/8/9)', 'ABCD0189EFGH6789'],
    ['lowercase', 'abcd2345efgh6789'],
    ['empty', ''],
  ])('rejects an invalid recovery code (%s)', (_label, code) => {
    const result = recoveryLoginSchema.safeParse({ code });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe(`${KEY}.recoveryLength`);
  });
});

it('exposes empty default values', () => {
  expect(mfaLoginDefaultValues).toEqual({ code: '' });
});
