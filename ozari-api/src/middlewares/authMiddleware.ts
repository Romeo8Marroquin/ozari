import { NextFunction, Response } from 'express';
import i18next from 'i18next';
import jwt from 'jsonwebtoken';

import { prismaClient } from '@deps/prismaClient';
import { logger } from '@deps/winstonConfig';
import { JwtPayloadModel } from '@models/common/authModel';
import { CustomRequest } from '@models/common/customRequestModel';
import { HttpEnum } from '@models/enums/httpEnum';
import { RolesEnum } from '@models/enums/rolesEnum';
import { TokenEnum } from '@models/enums/tokenEnum';
import { sendOzariError } from '@models/http/ozariErrorModel';
import { getSecret } from '@helpers/ssmLoader';

export const verifyJwt = async (req: CustomRequest, res: Response, next: NextFunction) => {
  try {
    const jwtSecret = await getSecret('jwt_secret');
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) {
      logger.error(i18next.t('middlewares.auth.logs.unauthorized', { token }));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('middlewares.auth.defaultMessage'));
      return;
    }
    const jwtPayload = jwt.verify(token, jwtSecret) as JwtPayloadModel;
    if (jwtPayload.tokenType !== TokenEnum.ACCESS_TOKEN) {
      logger.error(
        i18next.t('middlewares.auth.logs.invalidTokenType', {
          expected: TokenEnum[TokenEnum.ACCESS_TOKEN],
          received: TokenEnum[jwtPayload.tokenType],
        }),
      );
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('middlewares.auth.defaultMessage'));
      return;
    }

    const jwtActiveTokens = await prismaClient.jwtSession.findMany({
      where: {
        deviceUuid: jwtPayload.deviceUuid,
        isActive: true,
        tokenTypeId: TokenEnum.ACCESS_TOKEN,
        userId: jwtPayload.userId,
      },
    });

    if (jwtActiveTokens.length !== 1) {
      logger.error(
        i18next.t('middlewares.auth.logs.jwtRegisterError', {
          count: jwtActiveTokens.length,
          jti: jwtPayload.jti,
        }),
      );
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('middlewares.auth.defaultMessage'));
      return;
    }

    if (jwtActiveTokens[0]?.jti !== jwtPayload.jti) {
      logger.error(
        i18next.t('middlewares.auth.logs.jwtMismatch', {
          expected: jwtActiveTokens[0]?.jti,
          received: jwtPayload.jti,
        }),
      );
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('middlewares.auth.defaultMessage'));
      return;
    }

    req.user = jwtPayload;
    logger.info(
      i18next.t('middlewares.auth.logs.successAuth', {
        role: RolesEnum[jwtPayload.userRole],
        userId: jwtPayload.userId,
      }),
    );
    next();
  } catch (error) {
    logger.error(i18next.t('middlewares.auth.logs.internalServerError', { error }));
    sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('middlewares.auth.defaultMessage'));
  }
};
