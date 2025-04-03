import { Request, Response } from 'express';
import i18next from 'i18next';

import { logger } from '../logs/winstonConfig.js';
import { HttpEnum } from '../models/enums/httpEnum.js';
import { sendOzariError } from '../models/http/ozariErrorModel.js';

export const disableEndpoint = (req: Request, res: Response) => {
  logger.info(
    i18next.t('middlewares.disabled.logs.defaultMessage', {
      method: req.method,
      url: req.originalUrl,
    }),
  );
  sendOzariError(res, HttpEnum.FORBIDDEN, i18next.t('middlewares.disabled.defaultMessage'));
};
