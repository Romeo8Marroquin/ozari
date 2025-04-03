import { NextFunction, Request, Response } from 'express';
import i18next from 'i18next';

import { emailRegex, fullNameRegex, genericUuidRegex, passwordRegex } from '../helpers/regex.js';
import { logger } from '../logs/winstonConfig.js';
import { HttpEnum } from '../models/enums/httpEnum.js';
import { sendOzariError } from '../models/http/ozariErrorModel.js';
import {
  CreateUserRequestModel,
  SignInUserRequestModel,
} from '../models/request/userRequestModels.js';

export function validateCreateUser(req: Request, res: Response, next: NextFunction): void {
  const { confirmPassword, email, fullName, password, termsAccepted } =
    req.body as CreateUserRequestModel;

  if (typeof fullName !== 'string' || fullName.trim() === '' || !fullNameRegex.test(fullName)) {
    logger.info(i18next.t('user.createUser.validators.logs.invalidFullName', { fullName }));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('user.createUser.validators.invalidFullName'),
    );
    return;
  }

  if (typeof email !== 'string' || !emailRegex.test(email)) {
    logger.info(i18next.t('user.createUser.validators.logs.invalidEmail', { email }));
    sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t('user.createUser.validators.invalidEmail'));
    return;
  }

  if (typeof password !== 'string' || !passwordRegex.test(password)) {
    logger.info(i18next.t('user.createUser.validators.logs.invalidPassword', { password }));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('user.createUser.validators.invalidPassword'),
    );
    return;
  }

  if (password !== confirmPassword) {
    logger.info(
      i18next.t('user.createUser.validators.logs.passwordsDoNotMatch', {
        confirmPassword,
        password,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('user.createUser.validators.passwordsDoNotMatch'),
    );
    return;
  }

  if (typeof termsAccepted !== 'boolean' || !termsAccepted) {
    logger.info(i18next.t('user.createUser.validators.logs.termsNotAccepted', { termsAccepted }));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('user.createUser.validators.termsNotAccepted'),
    );
    return;
  }

  const validatedBody: CreateUserRequestModel = {
    confirmPassword,
    email,
    fullName: fullName.trim(),
    password,
    termsAccepted,
  };
  req.body = validatedBody;

  next();
}

export function validateSignIn(req: Request, res: Response, next: NextFunction): void {
  const { email, password } = req.body as SignInUserRequestModel;
  const deviceUuid = req.headers['device-uuid'] as string | undefined;
  if (!deviceUuid || !genericUuidRegex.test(deviceUuid)) {
    logger.info(
      i18next.t('user.signInUser.validators.logs.deviceUuidMissing', { uuid: deviceUuid }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('user.signInUser.validators.deviceUuidMissing'),
    );
    return;
  }

  if (typeof email !== 'string' || !emailRegex.test(email)) {
    logger.info(i18next.t('user.signInUser.validators.logs.invalidEmail', { email }));
    sendOzariError(res, HttpEnum.BAD_REQUEST, i18next.t('user.signInUser.validators.invalidEmail'));
    return;
  }

  if (typeof password !== 'string' || !passwordRegex.test(password)) {
    logger.info(i18next.t('user.signInUser.validators.logs.invalidPassword', { password }));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('user.signInUser.validators.invalidPassword'),
    );
    return;
  }

  const validatedBody: SignInUserRequestModel = {
    email,
    password,
  };
  req.body = validatedBody;

  next();
}
