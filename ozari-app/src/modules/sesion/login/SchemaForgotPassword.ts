import { emailField } from '@utils/formFields';
import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { z } from 'zod';

// Mirrors the backend `forgotPassword` validator — a single email field (same rules as login).
export const forgotPasswordSchema = z.object({
  email: emailField,
});

export type ForgotPasswordType = z.infer<typeof forgotPasswordSchema>;

export const forgotPasswordDefaultValues: ForgotPasswordType = {
  email: '',
};

export const forgotRequiredPatterns = getZodRequiredPatterns(forgotPasswordSchema);
