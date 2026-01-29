import { NextFunction, Request, Response } from 'express';
import i18next from 'i18next';

import { logger } from '@deps/winstonConfig';
import { HttpEnum } from '@models/enums/httpEnum';
import { sendOzariError } from '@models/http/ozariErrorModel';
import { getSecret } from '@helpers/ssmLoader';

let cachedApiKey: string | null = null;

export const validateApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = req.header('x-api-key');

    if (!apiKey) {
      logger.warn(i18next.t('middlewares.apiKey.logs.missingApiKey'));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('middlewares.apiKey.defaultMessage'));
      return;
    }

    if (!cachedApiKey) {
      cachedApiKey = await getSecret('api_key');
    }

    if (apiKey !== cachedApiKey) {
      logger.warn(i18next.t('middlewares.apiKey.logs.invalidApiKey'));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('middlewares.apiKey.defaultMessage'));
      return;
    }

    next();
  } catch (error) {
    logger.error(i18next.t('middlewares.apiKey.logs.internalServerError', { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t('middlewares.apiKey.internalServerError'),
    );
  }
};
