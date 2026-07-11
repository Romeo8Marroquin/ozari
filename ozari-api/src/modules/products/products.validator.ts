/* eslint-disable sonarjs/cognitive-complexity */
import type { NextFunction, Request, Response } from "express";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { descriptionTextRegex, fullNameRegex } from "@helpers/regex.js";
import { isValidEnumValue } from "@helpers/utils.js";
import { BusinessTypeEnum } from "@models/enums/businessTypeEnum.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { appConfig } from "@/config/app.js";
import {
  type CreateProductDetailRequestModel,
  type CreateProductRequestModel,
  type UpdateProductDetailRequestModel,
  type UpdateProductRequestModel,
} from "./products.models.js";

/**
 * Sanitizes an OPTIONAL money field: absent stays absent; a present value must be a number within
 * `[0, maxGlobalAmount]` and is truncated to 2 decimals (never rounded up — we don't invent cents).
 * `ok: false` means the field was present but invalid (the caller sends its own 400).
 */
const sanitizeOptionalMoney = (
  value: unknown,
): { ok: true; value: number | undefined } | { ok: false } => {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    value < 0 ||
    value > appConfig.maxGlobalAmount
  ) {
    return { ok: false };
  }
  return { ok: true, value: Math.trunc(value * 100) / 100 };
};

/** Log the create-validator warning for `key` and send its standard 400 (both share the key name). */
const rejectCreate = (
  res: Response,
  key: string,
  logParams: Record<string, unknown>,
): void => {
  logger.warn(
    i18next.t(`products.createProduct.validators.logs.${key}`, logParams),
  );
  sendOzariError(
    res,
    HttpEnum.BAD_REQUEST,
    i18next.t(`products.createProduct.validators.${key}`),
  );
};

export const validateCreateProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      businessTypeId,
      categoryId,
      currencyId,
      description,
      name,
      productDetails,
      quantity,
      rentPrice,
      rentTimeUnitId,
      replacementPrice,
      sellPrice,
    } = req.body as CreateProductRequestModel;

    if (
      !businessTypeId ||
      !isValidEnumValue(BusinessTypeEnum, businessTypeId)
    ) {
      rejectCreate(res, "invalidBusinessTypeId", { businessTypeId });
      return;
    }
    const prismaClient = await getPrismaClient();
    const validCategories = await prismaClient.productCategory.findFirst({
      where: { id: (categoryId as number | undefined) ?? 0, isActive: true },
    });
    if (!categoryId || !validCategories) {
      rejectCreate(res, "invalidCategoryId", { categoryId });
      return;
    }

    const validCurrencies = await prismaClient.currency.findFirst({
      where: { id: (currencyId as number | undefined) ?? 0, isActive: true },
    });
    if (!currencyId || !validCurrencies) {
      rejectCreate(res, "invalidCurrencyId", { currencyId });
      return;
    }

    if (description?.trim() && !descriptionTextRegex.test(description)) {
      rejectCreate(res, "invalidDescription", { description });
      return;
    }

    if (!name || !fullNameRegex.test(name)) {
      rejectCreate(res, "invalidName", { name });
      return;
    }

    const validProductDetails = await prismaClient.productDetailType.findMany({
      select: { id: true },
      where: { isActive: true },
    });
    const sanitizedProductDetails: CreateProductDetailRequestModel[] = [];
    const reqProductDetails = productDetails as
      | CreateProductDetailRequestModel[]
      | undefined;
    for (const detail of reqProductDetails ?? []) {
      if (
        !detail.detailTypeId ||
        !validProductDetails.some((d) => d.id === detail.detailTypeId)
      ) {
        rejectCreate(res, "invalidDetailTypeId", {
          detailTypeId: detail.detailTypeId,
        });
        return;
      }
      if (!detail.detail || !fullNameRegex.test(detail.detail)) {
        rejectCreate(res, "invalidDetail", { detail: detail.detail });
        return;
      }
      sanitizedProductDetails.push({
        detail: detail.detail.trim(),
        detailTypeId: detail.detailTypeId,
      });
    }

    if (
      (!quantity && quantity !== 0) ||
      typeof quantity !== "number" ||
      quantity < 0 ||
      quantity > appConfig.maxGlobalQuantity
    ) {
      rejectCreate(res, "invalidQuantity", { quantity });
      return;
    }

    const rentMoney = sanitizeOptionalMoney(rentPrice);
    if (!rentMoney.ok) {
      rejectCreate(res, "invalidRentPrice", { rentPrice });
      return;
    }

    const sellMoney = sanitizeOptionalMoney(sellPrice);
    if (!sellMoney.ok) {
      rejectCreate(res, "invalidSellPrice", { sellPrice });
      return;
    }

    const replacementMoney = sanitizeOptionalMoney(replacementPrice);
    if (!replacementMoney.ok) {
      rejectCreate(res, "invalidReplacementPrice", { replacementPrice });
      return;
    }

    // The CONDITIONAL price rule — a product is exactly ONE business type:
    // Alquiler → rentPrice + a valid rent time unit, sellPrice forbidden; Venta → sellPrice only,
    // rent fields forbidden. `replacementPrice` is optional for both (always captured when given).
    const isRent = businessTypeId === BusinessTypeEnum.RENT;
    const hasRentTimeUnit =
      rentTimeUnitId !== undefined && rentTimeUnitId !== null;
    const pricingParams = { businessTypeId, rentPrice, sellPrice, rentTimeUnitId };
    if (isRent) {
      if (sellMoney.value !== undefined) {
        rejectCreate(res, "pricingMismatch", pricingParams);
        return;
      }
      if (rentMoney.value === undefined) {
        rejectCreate(res, "rentPricingRequired", { rentPrice });
        return;
      }
      const validRentTimeUnit = hasRentTimeUnit
        ? await prismaClient.rentTimeUnit.findFirst({
            where: { id: rentTimeUnitId, isActive: true },
          })
        : null;
      if (!validRentTimeUnit) {
        rejectCreate(res, "invalidRentTimeUnitId", { rentTimeUnitId });
        return;
      }
    } else {
      if (rentMoney.value !== undefined || hasRentTimeUnit) {
        rejectCreate(res, "pricingMismatch", pricingParams);
        return;
      }
      if (sellMoney.value === undefined) {
        rejectCreate(res, "sellPricingRequired", { sellPrice });
        return;
      }
    }

    const validatedBody: CreateProductRequestModel = {
      businessTypeId,
      categoryId,
      currencyId,
      description: description?.trim() ? description.trim() : undefined,
      name: name.trim(),
      productDetails: sanitizedProductDetails,
      quantity,
      rentPrice: isRent ? rentMoney.value : undefined,
      rentTimeUnitId: isRent ? rentTimeUnitId : undefined,
      replacementPrice: replacementMoney.value,
      sellPrice: isRent ? undefined : sellMoney.value,
    };
    req.body = validatedBody;
    next();
  } catch (error) {
    logger.error(
      i18next.t("products.createProduct.validators.logs.validationError", {
        error,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.createProduct.validators.validationError"),
    );
  }
};

export const validateUpdateProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      businessTypeId,
      categoryId,
      currencyId,
      description,
      id,
      name,
      productDetails,
      quantity,
      rentPrice,
      sellPrice,
    } = req.body as UpdateProductRequestModel;

    if (
      !businessTypeId ||
      !isValidEnumValue(BusinessTypeEnum, businessTypeId)
    ) {
      logger.warn(
        i18next.t(
          "products.createProduct.validators.logs.invalidBusinessTypeId",
          {
            businessTypeId,
          },
        ),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.createProduct.validators.invalidBusinessTypeId"),
      );
      return;
    }
    const prismaClient = await getPrismaClient();
    const validCategories = await prismaClient.productCategory.findFirst({
      where: { id: (categoryId as number | undefined) ?? 0, isActive: true },
    });
    if (!categoryId || !validCategories) {
      logger.warn(
        i18next.t("products.createProduct.validators.logs.invalidCategoryId", {
          categoryId,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.createProduct.validators.invalidCategoryId"),
      );
      return;
    }

    const validCurrencies = await prismaClient.currency.findFirst({
      where: { id: (currencyId as number | undefined) ?? 0, isActive: true },
    });
    if (!currencyId || !validCurrencies) {
      logger.warn(
        i18next.t("products.createProduct.validators.logs.invalidCurrencyId", {
          currencyId,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.createProduct.validators.invalidCurrencyId"),
      );
      return;
    }

    if (description?.trim() && !descriptionTextRegex.test(description)) {
      logger.warn(
        i18next.t("products.createProduct.validators.logs.invalidDescription", {
          description,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.createProduct.validators.invalidDescription"),
      );
      return;
    }

    const validProduct = await prismaClient.product.findFirst({
      where: { id: (id as number | undefined) ?? 0, isActive: true },
    });
    if (!validProduct) {
      logger.warn(
        i18next.t("products.updateProduct.validators.logs.invalidId", { id }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.updateProduct.validators.invalidId"),
      );
      return;
    }

    if (!name || !fullNameRegex.test(name)) {
      logger.warn(
        i18next.t("products.createProduct.validators.logs.invalidName", {
          name,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.createProduct.validators.invalidName"),
      );
      return;
    }

    const validProductDetailsTypes =
      await prismaClient.productDetailType.findMany({
        select: { id: true },
        where: { isActive: true },
      });
    const validProductDetails = await prismaClient.productDetail.findMany({
      select: { id: true },
      where: { isActive: true, productId: id },
    });
    const sanitizedProductDetails: UpdateProductDetailRequestModel[] = [];
    const reqProductDetails = productDetails as
      | undefined
      | UpdateProductDetailRequestModel[];
    for (const detail of reqProductDetails ?? []) {
      if (!detail.id || !validProductDetails.some((d) => d.id === detail.id)) {
        logger.warn(
          i18next.t("products.updateProduct.validators.logs.invalidDetailId", {
            detailId: detail.id,
          }),
        );
        sendOzariError(
          res,
          HttpEnum.BAD_REQUEST,
          i18next.t("products.updateProduct.validators.invalidDetailId"),
        );
        return;
      }

      if (
        !detail.detailTypeId ||
        !validProductDetailsTypes.some((d) => d.id === detail.detailTypeId)
      ) {
        logger.warn(
          i18next.t(
            "products.createProduct.validators.logs.invalidDetailTypeId",
            {
              detailTypeId: detail.detailTypeId,
            },
          ),
        );
        sendOzariError(
          res,
          HttpEnum.BAD_REQUEST,
          i18next.t("products.createProduct.validators.invalidDetailTypeId"),
        );
        return;
      }

      if (!detail.detail || !fullNameRegex.test(detail.detail)) {
        logger.warn(
          i18next.t("products.createProduct.validators.logs.invalidDetail", {
            detail: detail.detail,
          }),
        );
        sendOzariError(
          res,
          HttpEnum.BAD_REQUEST,
          i18next.t("products.createProduct.validators.invalidDetail"),
        );
        return;
      }
      sanitizedProductDetails.push({
        detail: detail.detail.trim(),
        detailTypeId: detail.detailTypeId,
        id: detail.id,
      });
    }

    if (
      (!quantity && quantity !== 0) ||
      typeof quantity !== "number" ||
      quantity < 0 ||
      quantity > appConfig.maxGlobalQuantity
    ) {
      logger.warn(
        i18next.t("products.createProduct.validators.logs.invalidQuantity", {
          quantity,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.createProduct.validators.invalidQuantity"),
      );
      return;
    }

    let sanitizedRentPrice: number | undefined;
    if (rentPrice || rentPrice === 0) {
      if (
        typeof rentPrice !== "number" ||
        rentPrice < 0 ||
        rentPrice > appConfig.maxGlobalAmount
      ) {
        logger.warn(
          i18next.t("products.createProduct.validators.logs.invalidRentPrice", {
            rentPrice,
          }),
        );
        sendOzariError(
          res,
          HttpEnum.BAD_REQUEST,
          i18next.t("products.createProduct.validators.invalidRentPrice"),
        );
        return;
      } else {
        sanitizedRentPrice = Math.trunc(rentPrice * 100) / 100;
      }
    }

    let sanitizedSellPrice: number | undefined;
    if (sellPrice || sellPrice === 0) {
      if (
        typeof sellPrice !== "number" ||
        sellPrice < 0 ||
        sellPrice > appConfig.maxGlobalAmount
      ) {
        logger.warn(
          i18next.t("products.createProduct.validators.logs.invalidSellPrice", {
            sellPrice,
          }),
        );
        sendOzariError(
          res,
          HttpEnum.BAD_REQUEST,
          i18next.t("products.createProduct.validators.invalidSellPrice"),
        );
        return;
      } else {
        sanitizedSellPrice = Math.trunc(sellPrice * 100) / 100;
      }
    }

    if (!sanitizedRentPrice && !sanitizedSellPrice) {
      logger.warn(
        i18next.t(
          "products.createProduct.validators.logs.invalidRentAndSellPrice",
          {
            rentPrice: sanitizedRentPrice,
            sellPrice: sanitizedSellPrice,
          },
        ),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.createProduct.validators.invalidRentAndSellPrice"),
      );
      return;
    }

    // WIP: update is NOT mounted yet. It still lacks the conditional price rule and the new
    // fields — `rentTimeUnitId`/`replacementPrice` pass through as absent until the update rebuild
    // lands. Kept compiling against the new request model only.
    const validatedBody: UpdateProductRequestModel = {
      businessTypeId,
      categoryId,
      currencyId,
      description: description?.trim(),
      id: id,
      name: name.trim(),
      productDetails: sanitizedProductDetails,
      quantity,
      rentPrice: sanitizedRentPrice,
      rentTimeUnitId: undefined,
      replacementPrice: undefined,
      sellPrice: sanitizedSellPrice,
    };
    req.body = validatedBody;
    next();
  } catch (error) {
    logger.error(
      i18next.t("products.updateProduct.validators.logs.validationError", {
        error,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.updateProduct.validators.validationError"),
    );
  }
};

export const validateDeleteProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.query;
    if (!id || Number.isNaN(Number(id))) {
      logger.warn(
        i18next.t("products.deleteProduct.validators.logs.invalidId", { id }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.deleteProduct.validators.invalidId"),
      );
      return;
    }
    const prismaClient = await getPrismaClient();
    const validProduct = await prismaClient.product.findFirst({
      where: { id: Number(id), isActive: true },
    });
    if (!validProduct) {
      logger.warn(
        i18next.t("products.deleteProduct.validators.logs.invalidId", { id }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.deleteProduct.validators.invalidId"),
      );
      return;
    }
    next();
  } catch (error) {
    logger.error(
      i18next.t("products.deleteProduct.validators.logs.validationError", {
        error,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.deleteProduct.validators.validationError"),
    );
  }
};
