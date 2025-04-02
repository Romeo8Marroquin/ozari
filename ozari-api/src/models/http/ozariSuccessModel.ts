import { HttpEnum } from '../enums/httpEnum.js';
import { SubCodeSuccessEnum } from '../enums/subCodeSuccessEnum.js';

export interface OzariHttpSuccessModel<T = unknown> {
  data: T;
  message: string;
  status: HttpEnum;
  subCode?: SubCodeSuccessEnum;
}

export function createOzariHttpSuccess<T>(
  status: HttpEnum,
  message: string,
  data: T,
  subCode: SubCodeSuccessEnum = SubCodeSuccessEnum.EMPTY,
): OzariHttpSuccessModel<T> {
  return {
    data,
    message,
    status,
    subCode,
  };
}
