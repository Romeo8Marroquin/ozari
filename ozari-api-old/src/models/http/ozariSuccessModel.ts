import { Response } from 'express';

import { HttpEnum } from '../enums/httpEnum.js';
import { SubCodeSuccessEnum } from '../enums/subCodeSuccessEnum.js';

export interface OzariHttpSuccessModel<T = unknown> {
  data: T | undefined;
  message: string;
  status: HttpEnum;
  subCode?: SubCodeSuccessEnum;
}

export function createOzariHttpSuccess<T>(
  status: HttpEnum,
  message: string,
  data: T | undefined,
  subCode: SubCodeSuccessEnum = SubCodeSuccessEnum.EMPTY,
): OzariHttpSuccessModel<T> {
  return {
    data,
    message,
    status,
    subCode,
  };
}

export function sendOzariSuccess(
  res: Response,
  status: HttpEnum,
  message: string,
  data?: unknown,
  subCode: SubCodeSuccessEnum = SubCodeSuccessEnum.EMPTY,
): void {
  const ozariHttpSuccess = createOzariHttpSuccess(status, message, data, subCode);
  res.status(status).json(ozariHttpSuccess);
}
