import { describe, expect, it } from 'vitest';
import { mfaCodeDefaultValues, mfaCodeSchema } from './SchemaMfaCode';

const KEY = 'modules.panel.settings.security.mfa.enable.errors';

describe('mfaCodeSchema', () => {
  it('accepts exactly six digits', () => {
    expect(mfaCodeSchema.safeParse({ code: '123456' }).success).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    const result = mfaCodeSchema.safeParse({ code: '  123456  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe('123456');
  });

  it.each([
    ['too short', '12345'],
    ['too long', '1234567'],
    ['non-digits', 'abcdef'],
    ['empty', ''],
  ])('rejects a %s code with the format (length) message', (_label, code) => {
    const result = mfaCodeSchema.safeParse({ code });
    expect(result.success).toBe(false);
    if (!result.success) {
      // A local FORMAT hint, never the server's "incorrect/expired" copy — nothing has been submitted.
      expect(result.error.issues[0].message).toBe(`${KEY}.codeLength`);
    }
  });

  it('exposes empty default values', () => {
    expect(mfaCodeDefaultValues).toEqual({ code: '' });
  });
});
