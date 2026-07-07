import { passwordField } from '@utils/formFields';
import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { t } from 'i18next';
import { z } from 'zod';

const KEY = 'modules.panel.settings.security.password.modal.errors';

/**
 * Mirrors the backend `changePasswordSchema` (`ozari-api/.../auth.validator.ts`): current password
 * non-empty, new password = the shared full policy (`passwordField`), confirm matches. Plus a UX-only
 * `sameAsCurrent` guard that pre-empts the backend's reuse check (400) before submit.
 *
 * Split base/refine like the register schema: `getZodRequiredPatterns` needs the plain `ZodObject`
 * (it doesn't unwrap the `ZodEffects` a `.refine` produces).
 */
const baseChangePasswordSchema = z.object({
  currentPassword: z.string().nonempty(t(`${KEY}.requiredCurrent`)),
  newPassword: passwordField,
  confirmPassword: z.string().nonempty(t(`${KEY}.requiredConfirm`)),
});

export const changePasswordSchema = baseChangePasswordSchema
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: t(`${KEY}.mismatch`),
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword === '' || data.newPassword !== data.currentPassword, {
    message: t(`${KEY}.sameAsCurrent`),
    path: ['newPassword'],
  });

export type ChangePasswordType = z.infer<typeof changePasswordSchema>;

export const changePasswordDefaultValues: ChangePasswordType = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

export const changePasswordRequiredPatterns = getZodRequiredPatterns(baseChangePasswordSchema);
