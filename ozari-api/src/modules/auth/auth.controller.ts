import { Request, Response } from 'express';
import i18next from 'i18next';
import jwt from 'jsonwebtoken';

import {
  comparePassword,
  decryptKmsAsync,
  encryptKmsAsync,
  encryptSha256Sync,
  hashPassword,
} from '@deps/kmsClient';
import { prismaClient } from '@deps/prismaClient';
import { logger } from '@deps/winstonConfig';
import { getSecret } from '@helpers/ssmLoader';
import { JwtPayloadModel } from '@models/common/authModel';
import { CustomRequest, UserJwtPayloadModel } from '@models/common/customRequestModel';
import { HttpEnum } from '@models/enums/httpEnum';
import { RolesEnum } from '@models/enums/rolesEnum';
import { TokenEnum } from '@models/enums/tokenEnum';
import { sendOzariError } from '@models/http/ozariErrorModel';
import { sendOzariSuccess } from '@models/http/ozariSuccessModel';
import { applicationConfig } from '@src/applicationConfig';
import {
  CreateUserRequestModel,
  GetAllUsersResponseModel,
  SignInUserRequestModel,
} from './auth.models';

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await prismaClient.user.findMany({
      where: { isActive: true },
    });

    const [emails, fullNames] = await Promise.all([
      decryptKmsAsync(users.map((user) => user.emailKms)),
      decryptKmsAsync(users.map((user) => user.fullNameKms)),
    ]);
    const response: GetAllUsersResponseModel[] = users.map((user, index) => ({
      createdAt: user.createdAt,
      email: emails[index],
      fullName: fullNames[index],
      id: user.id,
      role: RolesEnum[user.roleId],
      updatedAt: user.updatedAt ?? undefined,
    }));

    logger.info(i18next.t('user.getAllUsers.logs.usersFetched', { count: users.length }));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t('user.getAllUsers.usersFetched'), response);
  } catch (error) {
    logger.error(i18next.t('user.getAllUsers.logs.internalServerError', { error }));
    sendOzariError(res, HttpEnum.INTERNAL_SERVER_ERROR, i18next.t('user.getAllUsers.genericError'));
  }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, fullName, password, termsAccepted } = req.body as CreateUserRequestModel;
    const emailSha = encryptSha256Sync(email);
    const existingUser = await prismaClient.user.findUnique({
      where: { emailSha },
    });
    if (existingUser) {
      logger.warn(i18next.t('user.createUser.logs.userAlreadyExists', { email }));
      sendOzariError(res, HttpEnum.CONFLICT, i18next.t('user.createUser.genericError'));
      return;
    }
    const encryptedName = await encryptKmsAsync(fullName);
    const encryptedEmail = await encryptKmsAsync(email);
    await prismaClient.user.create({
      data: {
        emailKms: encryptedEmail,
        emailSha,
        fullNameKms: encryptedName,
        passwordSha: hashPassword(password),
        roleId: RolesEnum.Client,
        termsAccepted,
      },
    });
    logger.info(i18next.t('user.createUser.logs.userCreated', { email }));
    sendOzariSuccess(res, HttpEnum.CREATED, i18next.t('user.createUser.userCreated'));
  } catch (error) {
    logger.error(i18next.t('user.createUser.logs.internalServerError'), error);
    sendOzariError(res, HttpEnum.INTERNAL_SERVER_ERROR, i18next.t('user.createUser.genericError'));
  }
};

export const signInUser = async (req: Request, res: Response): Promise<void> => {
  const { email, password, deviceUuid } = req.body as SignInUserRequestModel;

  try {
    const jwtSecret = await getSecret('jwt_secret');
    const jwtRefreshSecret = await getSecret('jwt_refresh_secret');
    const emailSha = encryptSha256Sync(email);
    const user = await prismaClient.user.findFirst({
      where: { emailSha, isActive: true },
    });
    if (!user) {
      logger.warn(i18next.t('user.signInUser.logs.userNotFound', { email }));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('user.signInUser.genericError'));
      return;
    }

    const passwordValid = comparePassword(password, user.passwordSha);
    if (!passwordValid) {
      logger.warn(i18next.t('user.signInUser.logs.invalidCredentials', { userId: user.id }));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('user.signInUser.genericError'));
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const accessJti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();
    const accessExp = now + applicationConfig.accessToken.expiresIn;
    const refreshExp = now + applicationConfig.refreshToken.expiresIn;

    const accessToken = jwt.sign(
      {
        jti: accessJti,
        iat: now,
        deviceUuid,
        tokenType: TokenEnum.ACCESS_TOKEN,
        userId: user.id,
        userRole: user.roleId,
      } as UserJwtPayloadModel,
      jwtSecret,
      applicationConfig.accessToken as jwt.SignOptions,
    );
    const refreshToken = jwt.sign(
      {
        jti: refreshJti,
        iat: now,
        deviceUuid,
        tokenType: TokenEnum.REFRESH_TOKEN,
        userId: user.id,
        userRole: user.roleId,
      } as UserJwtPayloadModel,
      jwtRefreshSecret,
      applicationConfig.refreshToken as jwt.SignOptions,
    );

    await prismaClient.$transaction(async (transaction) => {
      await transaction.jwtSession.deleteMany({
        where: { deviceUuid, isActive: true, userId: user.id },
      });
      await transaction.jwtSession.createMany({
        data: [
          {
            deviceUuid,
            expiresAt: new Date(accessExp * 1000),
            issuedAt: new Date(now * 1000),
            jti: accessJti,
            tokenTypeId: TokenEnum.ACCESS_TOKEN,
            userId: user.id,
          },
          {
            deviceUuid,
            expiresAt: new Date(refreshExp * 1000),
            issuedAt: new Date(now * 1000),
            jti: refreshJti,
            tokenTypeId: TokenEnum.REFRESH_TOKEN,
            userId: user.id,
          },
        ],
      });
    });

    res
      .header('Authorization', `Bearer ${accessToken}`)
      .cookie('refresh-token', refreshToken, applicationConfig.cookieConfig);

    logger.info(i18next.t('user.signInUser.logs.userAuthenticated', { userId: user.id }));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t('user.signInUser.userAuthenticated'));
  } catch (error) {
    logger.error(i18next.t('user.signInUser.logs.internalServerError'), error);
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t('user.signInUser.internalServerError'),
    );
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const jwtSecret = await getSecret('jwt_secret');
    const jwtRefreshSecret = await getSecret('jwt_refresh_secret');
    const refreshToken = req.cookies['refresh-token'] as string | undefined;
    if (!refreshToken) {
      logger.warn(i18next.t('user.refreshToken.logs.noRefreshToken'));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('user.refreshToken.genericError'));
      return;
    }
    const payload = jwt.verify(refreshToken, jwtRefreshSecret) as UserJwtPayloadModel;
    if (payload.tokenType !== TokenEnum.REFRESH_TOKEN) {
      logger.error(
        i18next.t('user.refreshToken.logs.invalidTokenType', {
          expected: TokenEnum[TokenEnum.REFRESH_TOKEN],
          received: TokenEnum[payload.tokenType],
        }),
      );
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('user.refreshToken.genericError'));
      return;
    }
    const foundSession = await prismaClient.jwtSession.findFirst({
      where: {
        jti: payload.jti,
        deviceUuid: payload.deviceUuid,
        tokenTypeId: TokenEnum.REFRESH_TOKEN,
        userId: payload.userId,
        isActive: true,
      },
    });

    if (!foundSession) {
      logger.error(i18next.t('user.refreshToken.logs.noRefreshToken'));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('user.refreshToken.genericError'));
      return;
    }

    if (foundSession.expiresAt <= new Date()) {
      logger.warn(i18next.t('user.refreshToken.logs.sessionExpired', { jti: foundSession.jti }));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('user.refreshToken.genericError'));
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const accessJti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();
    const accessExp = now + applicationConfig.accessToken.expiresIn;
    const refreshExp = now + applicationConfig.refreshToken.expiresIn;

    const accessToken = jwt.sign(
      {
        deviceUuid: foundSession.deviceUuid,
        jti: accessJti,
        tokenType: TokenEnum.ACCESS_TOKEN,
        userId: payload.userId,
        userRole: payload.userRole,
        iat: now,
      } as UserJwtPayloadModel,
      jwtSecret,
      applicationConfig.accessToken as jwt.SignOptions,
    );
    const newValidRefreshToken = jwt.sign(
      {
        deviceUuid: foundSession.deviceUuid,
        jti: refreshJti,
        tokenType: TokenEnum.REFRESH_TOKEN,
        userId: payload.userId,
        userRole: payload.userRole,
        iat: now,
      } as UserJwtPayloadModel,
      jwtRefreshSecret,
      applicationConfig.refreshToken as jwt.SignOptions,
    );

    await prismaClient.$transaction(async (transaction) => {
      await transaction.jwtSession.deleteMany({
        where: { deviceUuid: foundSession.deviceUuid, isActive: true, userId: payload.userId },
      });
      await transaction.jwtSession.createMany({
        data: [
          {
            deviceUuid: foundSession.deviceUuid,
            expiresAt: new Date(accessExp * 1000),
            issuedAt: new Date(now * 1000),
            jti: accessJti,
            tokenTypeId: TokenEnum.ACCESS_TOKEN,
            userId: payload.userId,
          },
          {
            deviceUuid: foundSession.deviceUuid,
            expiresAt: new Date(refreshExp * 1000),
            issuedAt: new Date(now * 1000),
            jti: refreshJti,
            tokenTypeId: TokenEnum.REFRESH_TOKEN,
            userId: payload.userId,
          },
        ],
      });
    });

    res
      .header('Authorization', `Bearer ${accessToken}`)
      .cookie('refresh-token', newValidRefreshToken, applicationConfig.cookieConfig);

    logger.info(
      i18next.t('user.refreshToken.logs.tokenRefreshed', {
        userId: payload.userId,
        userRole: payload.userRole,
      }),
    );
    sendOzariSuccess(res, HttpEnum.OK, i18next.t('user.refreshToken.tokenRefreshed'));
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError || error instanceof jwt.JsonWebTokenError) {
      logger.warn(i18next.t('user.refreshToken.logs.sessionExpiredOrInvalid'), error);
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('user.refreshToken.genericError'));
      return;
    }

    logger.error(i18next.t('user.refreshToken.logs.internalServerError', { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t('user.refreshToken.internalServerError'),
    );
  }
};

export const signOutUser = async (req: CustomRequest, res: Response): Promise<void> => {
  const allDevices = (req.query?.allDevices as string | undefined) === 'true';
  const { deviceUuid, userId, userRole } = req.user as JwtPayloadModel;
  try {
    if (allDevices) {
      await prismaClient.jwtSession.deleteMany({
        where: { isActive: true, userId },
      });
    } else {
      await prismaClient.jwtSession.deleteMany({
        where: { deviceUuid, isActive: true, userId },
      });
    }
    res.clearCookie('refresh-token', applicationConfig.cookieConfig);
    logger.info(i18next.t('user.signOutUser.logs.userSignedOut', { allDevices, userId, userRole }));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t('user.signOutUser.userSignedOut'));
  } catch (error) {
    logger.error(i18next.t('user.signOutUser.logs.internalServerError'), error);
    sendOzariError(res, HttpEnum.INTERNAL_SERVER_ERROR, i18next.t('user.signOutUser.genericError'));
  }
};
