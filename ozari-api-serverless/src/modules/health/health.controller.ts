import { Request, Response } from 'express';
import i18next from 'i18next';

import { logger } from '@deps/winstonConfig';
import { HttpEnum } from '@models/enums/httpEnum';
import { sendOzariSuccess } from '@models/http/ozariSuccessModel';

export const healthCheck = async (_: Request, res: Response): Promise<void> => {
  logger.info(i18next.t('health.check.logs.serviceHealthy'));
  sendOzariSuccess(res, HttpEnum.OK, i18next.t('health.check.serviceHealthy'));
};
