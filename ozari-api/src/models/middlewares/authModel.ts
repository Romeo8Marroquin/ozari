import { UserJwtPayloadModel } from './customRequestModel.js';

export interface JwtPayloadModel extends UserJwtPayloadModel {
  aud: string;
  exp: number;
  iat: number;
  iss: string;
}
