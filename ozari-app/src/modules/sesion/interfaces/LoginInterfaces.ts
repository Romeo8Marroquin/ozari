import type { OzariSuccessResponse } from '../../../types/api.types';

/**
 * Login response from backend
 * Note: Access token is returned in Authorization header, not in body
 * Refresh token is returned in HttpOnly cookie
 */
export type LoginResponseInterface = OzariSuccessResponse<undefined>;

/**
 * Registration response from backend (POST /auth/user). The new account is
 * created as a normal client and is pending admin enablement; no session is
 * issued by this endpoint.
 */
export type RegisterResponseInterface = OzariSuccessResponse<{ id: string } | undefined>;
