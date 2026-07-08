import { describe, expect, it } from 'vitest';
import {
  mfaDisableDefaultValues,
  mfaDisableRequiredPatterns,
  mfaDisableSchema,
} from './SchemaMfaDisable';

const KEY = 'modules.panel.settings.security.mfa.disable.errors';

describe('mfaDisableSchema', () => {
  it('accepts any non-empty password (no policy re-enforced — it is an existing credential)', () => {
    expect(mfaDisableSchema.safeParse({ password: 'x' }).success).toBe(true);
    expect(mfaDisableSchema.safeParse({ password: 'AnyOldThing1!' }).success).toBe(true);
  });

  it('rejects an empty password with the required message', () => {
    const result = mfaDisableSchema.safeParse({ password: '' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe(`${KEY}.requiredPassword`);
  });

  it('exposes empty defaults and a required-pattern for the password field', () => {
    expect(mfaDisableDefaultValues).toEqual({ password: '' });
    expect(mfaDisableRequiredPatterns.some((pattern) => pattern.test('password'))).toBe(true);
  });
});
