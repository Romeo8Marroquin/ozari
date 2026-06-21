/**
 * Standard Ozari API Success Response
 * Matches backend OzariHttpSuccessModel structure
 */
export interface OzariSuccessResponse<T = unknown> {
  status: number;
  message: string;
  data?: T;
  subCode?: number;
}

/**
 * Standard Ozari API Error Response
 * Matches backend OzariHttpErrorModel structure
 */
export interface OzariErrorResponse {
  status: number;
  message: string;
  subCode?: number;
  errors?: Array<{
    field?: string;
    message: string;
  }>;
}

/**
 * JWT Payload structure from backend
 * Matches backend UserJwtPayloadModel
 */
export interface JwtPayload {
  jti: string;
  iat: number;
  exp: number;
  deviceUuid: string;
  tokenType: number;
  userId: number;
  userRole: number;
}
