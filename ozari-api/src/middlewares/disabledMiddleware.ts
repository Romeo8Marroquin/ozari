import { Request, Response } from 'express';
import i18next from 'i18next';

import { logger } from '@deps/winstonConfig';
import { HttpEnum } from '@models/enums/httpEnum';
import { sendOzariError } from '@models/http/ozariErrorModel';

export const disableEndpoint = (req: Request, res: Response) => {
  logger.warn(
    i18next.t('middlewares.disabled.logs.defaultMessage', {
      method: req.method,
      url: req.originalUrl,
    }),
  );
  sendOzariError(res, HttpEnum.FORBIDDEN, i18next.t('middlewares.disabled.defaultMessage'));
};
