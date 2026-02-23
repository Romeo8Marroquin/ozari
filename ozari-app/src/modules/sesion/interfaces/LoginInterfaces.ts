import type { OzariSuccessResponse } from '../../../types/api.types';

/**
 * Login response from backend
 * Note: Access token is returned in Authorization header, not in body
 * Refresh token is returned in HttpOnly cookie
 */
export type LoginResponseInterface = OzariSuccessResponse<undefined>;
