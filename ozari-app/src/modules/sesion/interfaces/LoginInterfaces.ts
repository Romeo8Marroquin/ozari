import type { OzariSuccessResponse } from '../../../types/api.types';

/**
 * Login response from backend.
 * - Normal success: access token in the `Authorization` header, refresh token in an
 *   HttpOnly cookie, and no meaningful body `data`.
 * - 2FA enabled: `200` with `data: { mfaRequired, mfaToken }` and NO auth header; the
 *   real session is only issued by the follow-up `/auth/mfa/verify-login` call.
 */
export type LoginResponseInterface = OzariSuccessResponse<
  { mfaRequired: true; mfaToken: string } | undefined
>;

/**
 * Registration response from backend (POST /auth/user). The new account is
 * created as a normal client and is pending admin enablement; no session is
 * issued by this endpoint.
 */
export type RegisterResponseInterface = OzariSuccessResponse<{ id: string } | undefined>;
