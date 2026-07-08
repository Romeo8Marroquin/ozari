import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { t } from 'i18next';
import { z } from 'zod';

const KEY = 'modules.panel.settings.security.mfa.disable.errors';

/**
 * Mirrors the backend `mfaDisableSchema` (`ozari-api/.../auth.validator.ts`): the account password,
 * non-empty. It's an EXISTING credential (the backend re-verifies it → 422 on a wrong one), so we do
 * NOT re-enforce the full password policy here — presence is all the client needs.
 */
export const mfaDisableSchema = z.object({
  password: z.string().nonempty(t(`${KEY}.requiredPassword`)),
});

export type MfaDisableType = z.infer<typeof mfaDisableSchema>;

export const mfaDisableDefaultValues: MfaDisableType = { password: '' };

export const mfaDisableRequiredPatterns = getZodRequiredPatterns(mfaDisableSchema);
