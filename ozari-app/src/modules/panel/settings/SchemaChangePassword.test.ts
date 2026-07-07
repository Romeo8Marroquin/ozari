import { describe, expect, it } from 'vitest';
import { changePasswordSchema } from './SchemaChangePassword';

const valid = {
  currentPassword: 'OldPass1!234',
  newPassword: 'Passw0rd!123',
  confirmPassword: 'Passw0rd!123',
};

describe('changePasswordSchema', () => {
  it('accepts a valid change', () => {
    expect(changePasswordSchema.safeParse(valid).success).toBe(true);
  });

  it('requires a non-empty current password and a policy-compliant new one', () => {
    expect(changePasswordSchema.safeParse({ ...valid, currentPassword: '' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...valid, newPassword: 'weak', confirmPassword: 'weak' }).success).toBe(
      false,
    );
  });

  it('rejects a confirm mismatch (on the confirm field)', () => {
    const result = changePasswordSchema.safeParse({ ...valid, confirmPassword: 'Other1!2345' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('confirmPassword'))).toBe(true);
    }
  });

  it('rejects reusing the current password (pre-empts the backend 400)', () => {
    const same = 'Passw0rd!123';
    const result = changePasswordSchema.safeParse({
      currentPassword: same,
      newPassword: same,
      confirmPassword: same,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('newPassword'))).toBe(true);
    }
  });
});
