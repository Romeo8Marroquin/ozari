import type { Response } from "express";

import { HttpEnum } from "../enums/httpEnum.js";
import { SubCodeErrorEnum } from "../enums/subCodeErrorEnum.js";

export interface OzariHttpErrorModel {
  message: string;
  status: HttpEnum;
  subCode?: SubCodeErrorEnum;
  /** Optional STRUCTURED detail a client can act on beyond the message — e.g. the order-creation
   *  409 lists exactly which lines lack stock and the counts (EPIC-2 §8), so the form can
   *  re-offer instead of just apologizing. Absent on every other error (the message suffices). */
  data?: unknown;
}

export function createOzariHttpError(
  status: HttpEnum,
  message: string,
  subCode: SubCodeErrorEnum = SubCodeErrorEnum.EMPTY,
  data?: unknown,
): OzariHttpErrorModel {
  return {
    message,
    status,
    subCode,
    ...(data !== undefined && { data }),
  };
}

export function sendOzariError(
  response: Response,
  status: HttpEnum,
  message: string,
  subCode: SubCodeErrorEnum = SubCodeErrorEnum.EMPTY,
  data?: unknown,
): void {
  const ozariHttpError = createOzariHttpError(status, message, subCode, data);
  response.status(status).json(ozariHttpError);
}
