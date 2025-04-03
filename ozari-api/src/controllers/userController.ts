import { Request, Response } from 'express';
import i18next from 'i18next';
import jwt from 'jsonwebtoken';

import { applicationConfig } from '../applicationConfig.js';
import { prismaClient } from '../database/databaseClient.js';
import { decryptKmsAsync, encryptKmsAsync, encryptSha256Sync } from '../helpers/encryption.js';
import { logger } from '../logs/winstonConfig.js';
import { HttpEnum } from '../models/enums/httpEnum.js';
import { ProcessesEnum } from '../models/enums/processesEnum.js';
import { RolesEnum } from '../models/enums/rolesEnum.js';
import { TokenEnum } from '../models/enums/tokenEnum.js';
import { sendOzariError } from '../models/http/ozariErrorModel.js';
import { sendOzariSuccess } from '../models/http/ozariSuccessModel.js';
import { JwtPayloadModel } from '../models/middlewares/authModel.js';
import { CustomRequest, UserJwtPayloadModel } from '../models/middlewares/customRequestModel.js';
import {
  CreateUserRequestModel,
  SignInUserRequestModel,
} from '../models/request/userRequestModels.js';
import { GetAllUsersResponseModel } from '../models/response/userResponseModel.js';

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

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await prismaClient.user.findMany({
      where: { isActive: true },
    });

    const [emails, fullNames] = await Promise.all([
      await decryptKmsAsync(users.map((user) => user.emailKms)),
      await decryptKmsAsync(users.map((user) => user.fullNameKms)),
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
    const encryptedPassword = await encryptKmsAsync(password);
    const encryptedName = await encryptKmsAsync(fullName);
    const encryptedEmail = await encryptKmsAsync(email);
    await prismaClient.user.create({
      data: {
        emailKms: encryptedEmail,
        emailSha,
        fullNameKms: encryptedName,
        passwordKms: encryptedPassword,
        passwordSha: encryptSha256Sync(password),
        roleId: RolesEnum.Client,
        termsAccepted,
      },
    });
    logger.info(i18next.t('user.createUser.logs.userCreated', { email, fullName }));
    sendOzariSuccess(res, HttpEnum.CREATED, i18next.t('user.createUser.userCreated'));
  } catch (error) {
    logger.error(i18next.t('user.createUser.logs.internalServerError'), error);
    sendOzariError(res, HttpEnum.INTERNAL_SERVER_ERROR, i18next.t('user.createUser.genericError'));
  }
};

export const signInUser = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as SignInUserRequestModel;
  const deviceUuid = req.headers['device-uuid'] as string;

  try {
    const emailSha = encryptSha256Sync(email);
    const user = await prismaClient.user.findUnique({
      where: { emailSha, isActive: true },
    });
    if (!user) {
      logger.warn(i18next.t('user.signInUser.logs.userNotFound', { email }));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('user.signInUser.genericError'));
      return;
    }

    const inputPasswordHash = encryptSha256Sync(password);
    if (inputPasswordHash !== user.passwordSha) {
      logger.warn(i18next.t('user.signInUser.logs.invalidCredentials', { email, userId: user.id }));
      sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('user.signInUser.genericError'));
      return;
    }

    const accessToken = jwt.sign(
      {
        jti: crypto.randomUUID(),
        tokenType: TokenEnum.ACCESS_TOKEN,
        userId: user.id,
        userRole: user.roleId,
      } as UserJwtPayloadModel,
      jwtSecret,
      applicationConfig.accessToken as jwt.SignOptions,
    );
    const refreshToken = jwt.sign(
      {
        jti: crypto.randomUUID(),
        tokenType: TokenEnum.REFRESH_TOKEN,
        userId: user.id,
        userRole: user.roleId,
      } as UserJwtPayloadModel,
      jwtRefreshSecret,
      applicationConfig.refreshToken as jwt.SignOptions,
    );
    const accessTokenDecoded = jwt.decode(accessToken) as JwtPayloadModel;
    const refreshTokenDecoded = jwt.decode(refreshToken) as JwtPayloadModel;

    await prismaClient.$transaction(async (transaction) => {
      await transaction.jwtSession.updateMany({
        data: { isActive: false },
        where: { deviceUuid, isActive: true, userId: user.id },
      });
      await transaction.jwtSession.createMany({
        data: [
          {
            deviceUuid,
            expiresAt: new Date(accessTokenDecoded.exp * 1000),
            issuedAt: new Date(accessTokenDecoded.iat * 1000),
            jti: accessTokenDecoded.jti as string,
            tokenTypeId: TokenEnum.ACCESS_TOKEN,
            userId: user.id,
          },
          {
            deviceUuid,
            expiresAt: new Date(refreshTokenDecoded.exp * 1000),
            issuedAt: new Date(refreshTokenDecoded.iat * 1000),
            jti: refreshTokenDecoded.jti as string,
            tokenTypeId: TokenEnum.REFRESH_TOKEN,
            userId: user.id,
          },
        ],
      });
    });

    res
      .cookie('refresh-token', refreshToken, applicationConfig.cookieConfig)
      .header('Authorization', accessToken);

    logger.info(i18next.t('user.signInUser.logs.userAuthenticated', { email, userId: user.id }));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t('user.signInUser.userAuthenticated'));
  } catch (error) {
    logger.error(i18next.t('user.signInUser.logs.internalServerError', { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t('user.signInUser.internalServerError'),
    );
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies['refresh-token'] as string | undefined;
    if (!refreshToken) {
      logger.error(i18next.t('user.refreshToken.logs.noRefreshToken', { refreshToken }));
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
    const foundSession = await prismaClient.jwtSession.findFirstOrThrow({
      where: {
        isActive: true,
        jti: payload.jti,
        tokenTypeId: TokenEnum.REFRESH_TOKEN,
        userId: payload.userId,
      },
    });

    const accessToken = jwt.sign(
      {
        deviceUuid: foundSession.deviceUuid,
        jti: crypto.randomUUID(),
        tokenType: TokenEnum.ACCESS_TOKEN,
        userId: payload.userId,
        userRole: payload.userRole,
      } as UserJwtPayloadModel,
      jwtSecret,
      applicationConfig.accessToken as jwt.SignOptions,
    );
    const newValidRefreshToken = jwt.sign(
      {
        deviceUuid: foundSession.deviceUuid,
        jti: crypto.randomUUID(),
        tokenType: TokenEnum.REFRESH_TOKEN,
        userId: payload.userId,
        userRole: payload.userRole,
      } as UserJwtPayloadModel,
      jwtRefreshSecret,
      applicationConfig.refreshToken as jwt.SignOptions,
    );
    const accessTokenDecoded = jwt.decode(accessToken) as JwtPayloadModel;
    const refreshTokenDecoded = jwt.decode(newValidRefreshToken) as JwtPayloadModel;

    await prismaClient.$transaction(async (transaction) => {
      await transaction.jwtSession.updateMany({
        data: { isActive: false },
        where: { deviceUuid: foundSession.deviceUuid, isActive: true, userId: payload.userId },
      });
      await transaction.jwtSession.createMany({
        data: [
          {
            deviceUuid: accessTokenDecoded.deviceUuid,
            expiresAt: new Date(accessTokenDecoded.exp * 1000),
            issuedAt: new Date(accessTokenDecoded.iat * 1000),
            jti: accessTokenDecoded.jti as string,
            tokenTypeId: TokenEnum.ACCESS_TOKEN,
            userId: payload.userId,
          },
          {
            deviceUuid: refreshTokenDecoded.deviceUuid,
            expiresAt: new Date(refreshTokenDecoded.exp * 1000),
            issuedAt: new Date(refreshTokenDecoded.iat * 1000),
            jti: refreshTokenDecoded.jti as string,
            tokenTypeId: TokenEnum.REFRESH_TOKEN,
            userId: payload.userId,
          },
        ],
      });
    });

    res
      .cookie('refresh-token', newValidRefreshToken, applicationConfig.cookieConfig)
      .header('Authorization', accessToken);
    logger.info(
      i18next.t('user.refreshToken.logs.tokenRefreshed', {
        userId: payload.userId,
        userRole: payload.userRole,
      }),
    );
    sendOzariSuccess(res, HttpEnum.OK, i18next.t('user.refreshToken.tokenRefreshed'));
  } catch (error) {
    logger.error(i18next.t('user.refreshToken.logs.internalServerError', { error }));
    sendOzariError(res, HttpEnum.UNAUTHORIZED, i18next.t('user.refreshToken.genericError'));
  }
};

export const signOutUser = async (req: CustomRequest, res: Response): Promise<void> => {
  const allDevices = (req.query.allDevices as string | undefined) === 'true';
  const { deviceUuid, userId, userRole } = req.user as JwtPayloadModel;
  try {
    if (allDevices) {
      await prismaClient.jwtSession.updateMany({
        data: { isActive: false },
        where: { isActive: true, userId },
      });
    } else {
      await prismaClient.jwtSession.updateMany({
        data: { isActive: false },
        where: { deviceUuid, isActive: true, userId },
      });
    }
    res.clearCookie('refresh-token', applicationConfig.cookieConfig);
    logger.info(i18next.t('user.signOutUser.logs.userSignedOut', { userId }));
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t('user.signOutUser.userSignedOut', { allDevices, userId, userRole }),
    );
  } catch (error) {
    logger.error(i18next.t('user.signOutUser.logs.internalServerError', { error }));
    sendOzariError(res, HttpEnum.INTERNAL_SERVER_ERROR, i18next.t('user.signOutUser.genericError'));
  }
};
