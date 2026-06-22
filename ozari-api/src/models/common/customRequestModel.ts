import type { Request } from "express";
import { RolesEnum } from "../enums/rolesEnum.js";
import { TokenEnum } from "../enums/tokenEnum.js";

export interface CustomRequest extends Request {
  user?: UserJwtPayloadModel;
  mfaToken?: MfaTokenPayloadModel;
}

export interface MfaTokenPayloadModel {
  deviceUuid: string;
  tokenType: TokenEnum;
  userId: number;
  iat: number;
}

export interface UserJwtPayloadModel {
  deviceUuid: string;
  jti: string;
  tokenType: TokenEnum;
  userId: number;
  userRole: RolesEnum;
  iat: number;
}
