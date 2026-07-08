import { t } from 'i18next';
import { z } from 'zod';

const KEY = 'modules.sesion.login.mfa.errors';

/**
 * The MFA login challenge accepts EITHER a 6-digit TOTP OR a 16-char recovery code (the backend
 * `verify-login` takes both). The two are separate schemas — the step swaps the active resolver when
 * the user toggles between "authenticator" and "recovery code" — so each surfaces its own format hint
 * (a local shape check, never the server's "incorrect" copy, which only comes back after submit).
 *
 * The field pre-normalizes input (digits-only for TOTP; upper-cased, separators stripped for
 * recovery), so these validate the clean value. Recovery codes are base32 (`A–Z`, `2–7`, 16 chars).
 */
export const totpLoginSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, t(`${KEY}.codeLength`)),
});

export const recoveryLoginSchema = z.object({
  code: z.string().trim().regex(/^[A-Z2-7]{16}$/, t(`${KEY}.recoveryLength`)),
});

export type MfaLoginType = z.infer<typeof totpLoginSchema>;

export const mfaLoginDefaultValues: MfaLoginType = { code: '' };
