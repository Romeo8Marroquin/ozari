import {
  EMAIL_MAX_LENGTH,
  LOWER_REGEX,
  NUMBER_REGEX,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REGEX,
  SAFE_SYMBOL_REGEX,
  UNSAFE_SYMBOL_REGEX,
  UPPER_REGEX,
} from '@constants/Regex';
import { t } from 'i18next';
import { z } from 'zod';

/**
 * Canonical field schemas shared by every auth form (login, register, ...).
 *
 * These rules MUST stay in sync with the backend mirror in
 * `ozari-api/src/helpers/validators.ts` (+ `regex.ts`). Both sides must accept
 * and reject exactly the same values. The backend is the security boundary;
 * this is only the UX mirror, so messages are localized here.
 */
export const emailField = z
  .string()
  .nonempty(t('modules.sesion.login.form.requiredEmail'))
  .email(t('modules.sesion.login.form.invalidEmail'))
  .max(EMAIL_MAX_LENGTH, t('modules.sesion.login.form.maxLengthEmail'));

export const passwordField = z
  .string()
  .nonempty(t('modules.sesion.login.form.requiredPassword'))
  .min(PASSWORD_MIN_LENGTH, t('modules.sesion.login.form.minLengthPassword'))
  .max(PASSWORD_MAX_LENGTH, t('modules.sesion.login.form.maxLengthPassword'))
  .refine((val) => UPPER_REGEX.test(val), t('modules.sesion.login.form.uppercaseLetterPassword'))
  .refine((val) => LOWER_REGEX.test(val), t('modules.sesion.login.form.lowercaseLetterPassword'))
  .refine((val) => NUMBER_REGEX.test(val), t('modules.sesion.login.form.numberPassword'))
  .refine((val) => SAFE_SYMBOL_REGEX.test(val), t('modules.sesion.login.form.safeSymbolPassword'))
  .refine(
    (val) => !UNSAFE_SYMBOL_REGEX.test(val),
    t('modules.sesion.login.form.invalidSymbolPassword'),
  )
  // Final catch-all that exactly mirrors the backend `passwordRegex`.
  .refine((val) => PASSWORD_REGEX.test(val), t('modules.sesion.login.form.invalidPassword'));
