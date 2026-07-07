import { t } from 'i18next';
import { z } from 'zod';

const KEY = 'modules.panel.settings.security.mfa.enable.errors';

/**
 * The 6-digit TOTP code that confirms MFA enrollment. The backend `enableMfa` verifies it strictly
 * as a TOTP (recovery codes don't exist until *after* enabling), so the client enforces exactly six
 * digits — deliberately stricter than the shared server `mfaCodeSchema` (6–32 chars, which also
 * accepts a recovery code at the login challenge). Trimmed so a stray space from paste/autofill
 * doesn't fail the digit check. Reusable for the future two-step login screen.
 *
 * The message is a **format** hint ("enter 6 digits") — NOT the server's "incorrect code": at this
 * point nothing has been submitted, so we can't claim the code is wrong or expired, only that its
 * shape is off. The wrong-code copy (`errors.invalidCode`) comes back from the API after submit.
 */
export const mfaCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, t(`${KEY}.codeLength`)),
});

export type MfaCodeType = z.infer<typeof mfaCodeSchema>;

export const mfaCodeDefaultValues: MfaCodeType = { code: '' };
