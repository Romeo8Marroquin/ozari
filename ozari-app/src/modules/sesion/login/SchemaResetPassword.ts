import { passwordField } from '@utils/formFields';
import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { t } from 'i18next';
import { z } from 'zod';

// The token comes from the URL, not the form — the form only collects the new password + its
// confirmation. Mirrors the backend `resetPassword` validator (same password policy + match check).
const baseResetPasswordSchema = z.object({
  password: passwordField,
  confirmPassword: z.string().nonempty(t('modules.sesion.reset.requiredConfirmPassword')),
});

export const resetPasswordSchema = baseResetPasswordSchema.refine(
  (data) => data.password === data.confirmPassword,
  {
    message: t('modules.sesion.reset.passwordsDoNotMatch'),
    path: ['confirmPassword'],
  },
);

export type ResetPasswordType = z.infer<typeof resetPasswordSchema>;

export const resetPasswordDefaultValues: ResetPasswordType = {
  password: '',
  confirmPassword: '',
};

export const resetRequiredPatterns = getZodRequiredPatterns(baseResetPasswordSchema);
