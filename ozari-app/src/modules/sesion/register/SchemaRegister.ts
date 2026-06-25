import { emailField, fullNameField, passwordField } from '@utils/formFields';
import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { t } from 'i18next';
import { z } from 'zod';

const baseRegisterSchema = z.object({
  fullName: fullNameField,
  email: emailField,
  password: passwordField,
  confirmPassword: z.string().nonempty(t('modules.sesion.register.form.requiredConfirmPassword')),
  termsAccepted: z
    .boolean()
    .refine((val) => val === true, t('modules.sesion.register.form.requiredTerms')),
});

export const registerSchema = baseRegisterSchema.refine(
  (data) => data.password === data.confirmPassword,
  {
    message: t('modules.sesion.register.form.passwordsDoNotMatch'),
    path: ['confirmPassword'],
  },
);

export type RegisterType = z.infer<typeof registerSchema>;

export const registerSchemaDefaultValues: RegisterType = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
  termsAccepted: false,
};

export const registerRequiredPatterns = getZodRequiredPatterns(baseRegisterSchema);
