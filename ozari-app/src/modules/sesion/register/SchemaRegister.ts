import {
  LOWER_REGEX,
  NUMBER_REGEX,
  SAFE_SYMBOL_REGEX,
  UNSAFE_SYMBOL_REGEX,
  UPPER_REGEX,
} from '@constants/Regex';
import getZodRequiredPatterns from '../../../utils/getZodRequiredPatterns';
import { t } from 'i18next';
import { z } from 'zod';

export const registerSchema = z.object({
  email: z
    .string()
    .nonempty(t('modules.sesion.login.form.requiredEmail'))
    .email(t('modules.sesion.login.form.invalidEmail'))
    .max(128, t('modules.sesion.login.form.maxLengthEmail')),

  password: z
    .string()
    .nonempty(t('modules.sesion.login.form.requiredPassword'))
    .min(12, t('modules.sesion.login.form.minLengthPassword'))
    .max(128, t('modules.sesion.login.form.maxLengthPassword'))
    .refine((val) => UPPER_REGEX.test(val), t('modules.sesion.login.form.uppercaseLetterPassword'))
    .refine((val) => LOWER_REGEX.test(val), t('modules.sesion.login.form.lowercaseLetterPassword'))
    .refine((val) => NUMBER_REGEX.test(val), t('modules.sesion.login.form.numberPassword'))
    .refine((val) => SAFE_SYMBOL_REGEX.test(val), t('modules.sesion.login.form.safeSymbolPassword'))
    .refine(
      (val) => !UNSAFE_SYMBOL_REGEX.test(val),
      t('modules.sesion.login.form.invalidSymbolPassword'),
    ),
});

export type RegisterType = z.infer<typeof registerSchema>;

export const registerSchemaDefaultValues: RegisterType = {
  email: '',
  password: '',
};

export const registerRequiredPatterns = getZodRequiredPatterns(registerSchema);
