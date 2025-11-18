import { Request, Response } from 'express';
import i18next from 'i18next';

import { logger } from '@deps/winstonConfig';
import { HttpEnum } from '@models/enums/httpEnum';
import { ProcessesEnum } from '@models/enums/processesEnum';
import { sendOzariSuccess } from '@models/http/ozariSuccessModel';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  logger.error(i18next.t('middlewares.auth.logs.jwtSecretMissing'));
  process.exit(ProcessesEnum.JWT_SECRET_ERROR);
}
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
if (!jwtRefreshSecret) {
  logger.error(i18next.t('middlewares.auth.logs.jwtRefreshSecretMissing'));
  process.exit(ProcessesEnum.JWT_SECRET_ERROR);
}

export const healthCheck = async (_: Request, res: Response): Promise<void> => {
  logger.info(i18next.t('health.check.logs.serviceHealthy'));
  sendOzariSuccess(res, HttpEnum.OK, i18next.t('health.check.serviceHealthy'));
};
