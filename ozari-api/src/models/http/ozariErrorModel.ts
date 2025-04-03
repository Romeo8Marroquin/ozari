import { Response } from 'express';

import { HttpEnum } from '../enums/httpEnum.js';
import { SubCodeErrorEnum } from '../enums/subCodeErrorEnum.js';

export interface OzariHttpErrorModel {
  message: string;
  status: HttpEnum;
  subCode?: SubCodeErrorEnum;
}

export function createOzariHttpError(
  status: HttpEnum,
  message: string,
  subCode: SubCodeErrorEnum = SubCodeErrorEnum.EMPTY,
): OzariHttpErrorModel {
  return {
    message,
    status,
    subCode,
  };
}

export function sendOzariError(
  response: Response,
  status: HttpEnum,
  message: string,
  subCode: SubCodeErrorEnum = SubCodeErrorEnum.EMPTY,
): void {
  const ozariHttpError = createOzariHttpError(status, message, subCode);
  response.status(status).json(ozariHttpError);
}
