import { UUID } from 'crypto';
import { Request } from 'express';

import { RolesEnum } from '../enums/rolesEnum.js';
import { TokenEnum } from '../enums/tokenEnum.js';

export interface CustomRequest extends Request {
  user?: UserJwtPayloadModel;
}

export interface UserJwtPayloadModel {
  deviceUuid: UUID;
  jti: UUID;
  tokenType: TokenEnum;
  userId: number;
  userRole: RolesEnum;
}
