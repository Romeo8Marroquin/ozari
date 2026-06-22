import { emailField, passwordField } from '@utils/formFields';
import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { z } from 'zod';

export const registerSchema = z.object({
  email: emailField,
  password: passwordField,
});

export type RegisterType = z.infer<typeof registerSchema>;

export const registerSchemaDefaultValues: RegisterType = {
  email: '',
  password: '',
};

export const registerRequiredPatterns = getZodRequiredPatterns(registerSchema);
