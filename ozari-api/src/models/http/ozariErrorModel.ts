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
