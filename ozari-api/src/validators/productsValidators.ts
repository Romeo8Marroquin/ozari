import { NextFunction, Request, Response } from 'express';
import i18next from 'i18next';

import { applicationConfig } from '../applicationConfig.js';
import { prismaClient } from '../database/databaseClient.js';
import { descriptionTextRegex, fullNameRegex, genericHttpsUrlRegex } from '../helpers/regex.js';
import { isValidEnumValue } from '../helpers/utils.js';
import { logger } from '../logs/winstonConfig.js';
import { BusinessTypeEnum } from '../models/enums/businessTypeEnum.js';
import { HttpEnum } from '../models/enums/httpEnum.js';
import { sendOzariError } from '../models/http/ozariErrorModel.js';
import {
  CreateProductDetailRequestModel,
  CreateProductRequestModel,
} from '../models/request/productsRequestModels.js';

export const validateCreateProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const {
    businessTypeId,
    categoryId,
    currencyId,
    description,
    imageUrl,
    name,
    productDetails,
    quantity,
    rentPrice,
    sellPrice,
  } = req.body as CreateProductRequestModel;

  if (!businessTypeId || !isValidEnumValue(BusinessTypeEnum, businessTypeId)) {
    logger.warn(
      i18next.t('products.createProduct.validators.logs.invalidBusinessTypeId', { businessTypeId }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('products.createProduct.validators.invalidBusinessTypeId'),
    );
    return;
  }

  const validCategories = await prismaClient.productCategory.findFirst({
    where: { id: (categoryId as number | undefined) ?? 0, isActive: true },
  });
  if (!categoryId || !validCategories) {
    logger.warn(
      i18next.t('products.createProduct.validators.logs.invalidCategoryId', { categoryId }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('products.createProduct.validators.invalidCategoryId'),
    );
    return;
  }

  const validCurrencies = await prismaClient.currency.findFirst({
    where: { id: (currencyId as number | undefined) ?? 0, isActive: true },
  });
  if (!currencyId || !validCurrencies) {
    logger.warn(
      i18next.t('products.createProduct.validators.logs.invalidCurrencyId', { currencyId }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('products.createProduct.validators.invalidCurrencyId'),
    );
    return;
  }

  if (description?.trim() && !descriptionTextRegex.test(description)) {
    logger.warn(
      i18next.t('products.createProduct.validators.logs.invalidDescription', { description }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('products.createProduct.validators.invalidDescription'),
    );
    return;
  }

  if (imageUrl?.trim() && !genericHttpsUrlRegex.test(imageUrl)) {
    logger.warn(i18next.t('products.createProduct.validators.logs.invalidImageUrl', { imageUrl }));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('products.createProduct.validators.invalidImageUrl'),
    );
    return;
  }

  if (!name || !fullNameRegex.test(name)) {
    logger.warn(i18next.t('products.createProduct.validators.logs.invalidName', { name }));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('products.createProduct.validators.invalidName'),
    );
    return;
  }

  const validProductDetails = await prismaClient.productDetailType.findMany({
    select: { id: true },
    where: { isActive: true },
  });
  const sanitizedProductDetails: CreateProductDetailRequestModel[] = [];
  (productDetails as CreateProductDetailRequestModel[] | undefined)?.forEach((detail) => {
    if (!detail.detailTypeId || !validProductDetails.some((d) => d.id === detail.detailTypeId)) {
      logger.warn(
        i18next.t('products.createProduct.validators.logs.invalidDetailTypeId', {
          detailTypeId: detail.detailTypeId,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t('products.createProduct.validators.invalidDetailTypeId'),
      );
    }

    if (!detail.detail || !fullNameRegex.test(detail.detail)) {
      logger.warn(
        i18next.t('products.createProduct.validators.logs.invalidDetail', {
          detail: detail.detail,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t('products.createProduct.validators.invalidDetail'),
      );
    }
    sanitizedProductDetails.push({
      detail: detail.detail.trim(),
      detailTypeId: detail.detailTypeId,
    });
  });

  if (
    !quantity ||
    typeof quantity !== 'number' ||
    quantity < 0 ||
    quantity > applicationConfig.maxGlobalQuantity
  ) {
    logger.warn(i18next.t('products.createProduct.validators.logs.invalidQuantity', { quantity }));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('products.createProduct.validators.invalidQuantity'),
    );
    return;
  }

  let sanitizedRentPrice: number | undefined;
  if (rentPrice) {
    if (
      typeof rentPrice !== 'number' ||
      rentPrice < 0 ||
      rentPrice > applicationConfig.maxGlobalAmount
    ) {
      logger.warn(
        i18next.t('products.createProduct.validators.logs.invalidRentPrice', { rentPrice }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t('products.createProduct.validators.invalidRentPrice'),
      );
      return;
    } else {
      sanitizedRentPrice = Math.trunc(rentPrice * 100) / 100;
    }
  }

  let sanitizedSellPrice: number | undefined;
  if (sellPrice) {
    if (
      typeof sellPrice !== 'number' ||
      sellPrice < 0 ||
      sellPrice > applicationConfig.maxGlobalAmount
    ) {
      logger.warn(
        i18next.t('products.createProduct.validators.logs.invalidSellPrice', { sellPrice }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t('products.createProduct.validators.invalidSellPrice'),
      );
      return;
    } else {
      sanitizedSellPrice = Math.trunc(sellPrice * 100) / 100;
    }
  }

  if (!sanitizedRentPrice && !sanitizedSellPrice) {
    logger.warn(
      i18next.t('products.createProduct.validators.logs.invalidRentAndSellPrice', {
        rentPrice: sanitizedRentPrice,
        sellPrice: sanitizedSellPrice,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t('products.createProduct.validators.invalidRentAndSellPrice'),
    );
    return;
  }

  const validatedBody: CreateProductRequestModel = {
    businessTypeId,
    categoryId,
    currencyId,
    description: description?.trim(),
    imageUrl: imageUrl?.trim(),
    name: name.trim(),
    productDetails: sanitizedProductDetails,
    quantity,
    rentPrice: sanitizedRentPrice,
    sellPrice: sanitizedSellPrice,
  };
  req.body = validatedBody;
  next();
};
