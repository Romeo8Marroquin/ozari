import { Request, Response } from 'express';
import i18next from 'i18next';

import { logger } from '@deps/winstonConfig';
import { HttpEnum } from '@models/enums/httpEnum';
import { sendOzariSuccess } from '@models/http/ozariSuccessModel';
import { prismaClient } from '@deps/prismaClient';

export const healthCheck = async (_: Request, res: Response): Promise<void> => {
  logger.info(i18next.t('health.check.logs.serviceHealthy'));
  const userCount = await prismaClient.productCategory.count();
  logger.info(i18next.t('Test de categorías, encontradas: {{count}}', { count: userCount }));
  sendOzariSuccess(res, HttpEnum.OK, i18next.t('health.check.serviceHealthy'));
};
