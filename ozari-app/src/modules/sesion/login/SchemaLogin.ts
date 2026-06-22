import { emailField, passwordField } from '@utils/formFields';
import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { z } from 'zod';

export const loginSchema = z.object({
  email: emailField,
  password: passwordField,
});

export type LoginType = z.infer<typeof loginSchema>;

export const loginSchemaDefaultValues: LoginType = {
  email: '',
  password: '',
};

export const loginRequiredPatterns = getZodRequiredPatterns(loginSchema);
