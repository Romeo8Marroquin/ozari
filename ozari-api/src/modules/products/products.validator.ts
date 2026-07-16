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
  type CreateProductImageRequestModel,
  type CreateProductImageUploadsRequestModel,
  type CreateProductRequestModel,
  type ProductImageUploadFileModel,
  type UpdateProductDetailRequestModel,
  type UpdateProductImageRequestModel,
  type UpdateProductRequestModel,
} from "./products.models.js";

/**
 * Matches an R2 object key OUR upload-url endpoint mints for product images:
 * `products/<uuid v4>.<whitelisted extension>`. Built from the same config the mint uses, so the
 * create endpoint only ever persists keys that could have come from our own presign flow — an
 * arbitrary client-invented key (path traversal, another prefix, another bucket's layout) is a 400.
 */
const buildProductImageKeyRegex = (): RegExp => {
  const prefix = appConfig.storage.keyPrefixes.product;
  const extensions = Object.values(appConfig.storage.allowedImageTypes).join("|");
  // eslint-disable-next-line security/detect-non-literal-regexp -- built ONLY from static appConfig constants (never user input)
  return new RegExp(
    `^${prefix}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:${extensions})$`,
  );
};

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
      images,
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
    // A product carries at most ONE detail per type (a table can't have two "Color"s) — which also
    // caps the list at the number of active types.
    const seenDetailTypes = new Set<number>();
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
      if (seenDetailTypes.has(detail.detailTypeId)) {
        rejectCreate(res, "duplicateDetailType", {
          detailTypeId: detail.detailTypeId,
        });
        return;
      }
      seenDetailTypes.add(detail.detailTypeId);
      if (!detail.detail || !fullNameRegex.test(detail.detail)) {
        rejectCreate(res, "invalidDetail", { detail: detail.detail });
        return;
      }
      sanitizedProductDetails.push({
        detail: detail.detail.trim(),
        detailTypeId: detail.detailTypeId,
      });
    }

    // Gallery images (optional): keys must match OUR presign shape, no duplicates, at most one
    // explicit primary. When none is flagged the FIRST image becomes the primary (the UI default).
    const reqImages = images as CreateProductImageRequestModel[] | undefined;
    if (reqImages !== undefined && !Array.isArray(reqImages)) {
      rejectCreate(res, "invalidImages", { images });
      return;
    }
    if ((reqImages?.length ?? 0) > appConfig.storage.maxImagesPerProduct) {
      rejectCreate(res, "tooManyImages", {
        count: reqImages?.length,
        max: appConfig.storage.maxImagesPerProduct,
      });
      return;
    }
    const imageKeyRegex = buildProductImageKeyRegex();
    const seenImageKeys = new Set<string>();
    let primaryCount = 0;
    for (const image of reqImages ?? []) {
      if (typeof image?.key !== "string" || !imageKeyRegex.test(image.key)) {
        rejectCreate(res, "invalidImageKey", { key: image?.key });
        return;
      }
      if (seenImageKeys.has(image.key)) {
        rejectCreate(res, "duplicateImageKey", { key: image.key });
        return;
      }
      seenImageKeys.add(image.key);
      if (image.isPrimary === true) {
        primaryCount += 1;
      }
    }
    if (primaryCount > 1) {
      rejectCreate(res, "multiplePrimaryImages", { primaryCount });
      return;
    }
    const sanitizedImages: CreateProductImageRequestModel[] = (
      reqImages ?? []
    ).map((image, index) => ({
      key: image.key,
      isPrimary: primaryCount === 0 ? index === 0 : image.isPrimary === true,
    }));

    if (
      (!quantity && quantity !== 0) ||
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
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
    // rent fields forbidden. `replacementPrice` is Alquiler-only too (what a client pays for a
    // lost/damaged RENTAL — a sold item is simply consumed, there is nothing to replace).
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
      if (replacementMoney.value !== undefined) {
        rejectCreate(res, "replacementPriceForbidden", { replacementPrice });
        return;
      }
    }

    const validatedBody: CreateProductRequestModel = {
      businessTypeId,
      categoryId,
      currencyId,
      description: description?.trim() ? description.trim() : undefined,
      images: sanitizedImages,
      name: name.trim(),
      productDetails: sanitizedProductDetails,
      quantity,
      rentPrice: isRent ? rentMoney.value : undefined,
      rentTimeUnitId: isRent ? rentTimeUnitId : undefined,
      replacementPrice: isRent ? replacementMoney.value : undefined,
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

/** Log the update-validator warning for `key` and send its standard 400 (updateProduct namespace). */
const rejectUpdate = (
  res: Response,
  key: string,
  logParams: Record<string, unknown>,
): void => {
  logger.warn(
    i18next.t(`products.updateProduct.validators.logs.${key}`, logParams),
  );
  sendOzariError(
    res,
    HttpEnum.BAD_REQUEST,
    i18next.t(`products.updateProduct.validators.${key}`),
  );
};

/**
 * `PUT /products/:id` — the declarative full-state update (the RECONCILE design). Follows
 * `validateCreateProduct`'s shape exactly for the shared rules (same messages, same conditional
 * price rule), plus the update-only checks:
 *
 * - the `:id` param must be an existing ACTIVE product — malformed and unknown are both a plain
 *   `404`, like `GET /products/:id` (there is nothing for the client to "fix");
 * - each detail row either carries the `id` of one of THIS product's active details (keep/update)
 *   or none (create) — an id of another product, an unknown id, or a repeated id is a 400;
 * - each gallery slot carries exactly ONE of `id` (a kept photo of this product) or `key` (a new
 *   upload matching our presign shape) — same ownership/duplicate/primary rules.
 *
 * Ownership here is the request-shaped check; the transaction re-verifies kept ids against the
 * live rows (see `applyProductUpdate`), so a save racing another admin's delete is a clean 409.
 */
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
      images,
      name,
      productDetails,
      quantity,
      rentPrice,
      rentTimeUnitId,
      replacementPrice,
      sellPrice,
    } = req.body as UpdateProductRequestModel;

    // The target product: malformed id and unknown/soft-deleted product are both a 404 — a detail
    // lookup either finds the row or it doesn't (the getProductById stance).
    const productId = Number(req.params["id"]);
    const prismaClient = await getPrismaClient();
    const product =
      Number.isInteger(productId) && productId >= 1
        ? await prismaClient.product.findFirst({
            where: { id: productId, isActive: true },
            select: {
              id: true,
              productImages: { select: { id: true } },
              productDetails: { select: { id: true } },
            },
          })
        : null;
    if (!product) {
      logger.warn(
        i18next.t("products.updateProduct.validators.logs.productNotFound", {
          id: req.params["id"],
        }),
      );
      sendOzariError(
        res,
        HttpEnum.NOT_FOUND,
        i18next.t("products.updateProduct.validators.productNotFound"),
      );
      return;
    }

    if (
      !businessTypeId ||
      !isValidEnumValue(BusinessTypeEnum, businessTypeId)
    ) {
      rejectCreate(res, "invalidBusinessTypeId", { businessTypeId });
      return;
    }
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

    // Details — the FINAL desired list: rows with an `id` keep/update one of THIS product's active
    // details; rows without create. The create rules apply on top (valid type, one per type, text).
    const validDetailTypes = await prismaClient.productDetailType.findMany({
      select: { id: true },
      where: { isActive: true },
    });
    const sanitizedProductDetails: UpdateProductDetailRequestModel[] = [];
    const seenDetailTypes = new Set<number>();
    const seenDetailIds = new Set<number>();
    const reqProductDetails = productDetails as
      | UpdateProductDetailRequestModel[]
      | undefined;
    for (const detail of reqProductDetails ?? []) {
      if (detail.id !== undefined) {
        if (
          typeof detail.id !== "number" ||
          !product.productDetails.some((row) => row.id === detail.id) ||
          seenDetailIds.has(detail.id)
        ) {
          rejectUpdate(res, "invalidDetailId", { detailId: detail.id });
          return;
        }
        seenDetailIds.add(detail.id);
      }
      if (
        !detail.detailTypeId ||
        !validDetailTypes.some((d) => d.id === detail.detailTypeId)
      ) {
        rejectCreate(res, "invalidDetailTypeId", {
          detailTypeId: detail.detailTypeId,
        });
        return;
      }
      if (seenDetailTypes.has(detail.detailTypeId)) {
        rejectCreate(res, "duplicateDetailType", {
          detailTypeId: detail.detailTypeId,
        });
        return;
      }
      seenDetailTypes.add(detail.detailTypeId);
      if (!detail.detail || !fullNameRegex.test(detail.detail)) {
        rejectCreate(res, "invalidDetail", { detail: detail.detail });
        return;
      }
      sanitizedProductDetails.push({
        detail: detail.detail.trim(),
        detailTypeId: detail.detailTypeId,
        ...(detail.id !== undefined && { id: detail.id }),
      });
    }

    // Gallery — the FINAL desired list in display order: each slot is EXACTLY one of `id` (kept
    // photo of this product) or `key` (new upload, our presign shape). Same cap/dup/primary rules
    // as create; rows of the product absent from the list will be deleted by the reconcile.
    const reqImages = images as UpdateProductImageRequestModel[] | undefined;
    if (reqImages !== undefined && !Array.isArray(reqImages)) {
      rejectCreate(res, "invalidImages", { images });
      return;
    }
    if ((reqImages?.length ?? 0) > appConfig.storage.maxImagesPerProduct) {
      rejectCreate(res, "tooManyImages", {
        count: reqImages?.length,
        max: appConfig.storage.maxImagesPerProduct,
      });
      return;
    }
    const imageKeyRegex = buildProductImageKeyRegex();
    const seenImageKeys = new Set<string>();
    const seenImageIds = new Set<number>();
    let primaryCount = 0;
    for (const image of reqImages ?? []) {
      const hasId = image?.id !== undefined;
      const hasKey = image?.key !== undefined;
      if (!image || hasId === hasKey) {
        rejectUpdate(res, "invalidImageEntry", { image });
        return;
      }
      if (hasId) {
        if (
          typeof image.id !== "number" ||
          !product.productImages.some((row) => row.id === image.id) ||
          seenImageIds.has(image.id)
        ) {
          rejectUpdate(res, "invalidImageId", { imageId: image.id });
          return;
        }
        seenImageIds.add(image.id);
      } else {
        if (typeof image.key !== "string" || !imageKeyRegex.test(image.key)) {
          rejectCreate(res, "invalidImageKey", { key: image.key });
          return;
        }
        if (seenImageKeys.has(image.key)) {
          rejectCreate(res, "duplicateImageKey", { key: image.key });
          return;
        }
        seenImageKeys.add(image.key);
      }
      if (image.isPrimary === true) {
        primaryCount += 1;
      }
    }
    if (primaryCount > 1) {
      rejectCreate(res, "multiplePrimaryImages", { primaryCount });
      return;
    }
    const sanitizedImages: UpdateProductImageRequestModel[] = (
      reqImages ?? []
    ).map((image, index) => ({
      // The XOR check above guarantees exactly one side; `?? {}` keeps the compiler convinced.
      ...(image.id !== undefined
        ? { id: image.id }
        : image.key !== undefined
          ? { key: image.key }
          : {}),
      isPrimary: primaryCount === 0 ? index === 0 : image.isPrimary === true,
    }));

    if (
      (!quantity && quantity !== 0) ||
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
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

    // The CONDITIONAL price rule — identical to create (a product is exactly ONE business type),
    // and it applies to the product's NEW type: switching Alquiler → Venta must arrive with the
    // Venta shape (the reconcile then nulls the now-irrelevant columns).
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
      if (replacementMoney.value !== undefined) {
        rejectCreate(res, "replacementPriceForbidden", { replacementPrice });
        return;
      }
    }

    const validatedBody: UpdateProductRequestModel = {
      businessTypeId,
      categoryId,
      currencyId,
      description: description?.trim() ? description.trim() : undefined,
      images: sanitizedImages,
      name: name.trim(),
      productDetails: sanitizedProductDetails,
      quantity,
      rentPrice: isRent ? rentMoney.value : undefined,
      rentTimeUnitId: isRent ? rentTimeUnitId : undefined,
      replacementPrice: isRent ? replacementMoney.value : undefined,
      sellPrice: isRent ? undefined : sellMoney.value,
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

/** Log the upload-url validator warning for `key` and send its standard 400. */
const rejectUploads = (
  res: Response,
  key: string,
  logParams: Record<string, unknown>,
): void => {
  logger.warn(
    i18next.t(`products.imageUploads.validators.logs.${key}`, logParams),
  );
  sendOzariError(
    res,
    HttpEnum.BAD_REQUEST,
    i18next.t(`products.imageUploads.validators.${key}`),
  );
};

/**
 * `POST /products/images/upload-url` body: `{ files: [{ contentType, contentLength }] }`.
 * Mirrors the storage policy (whitelisted types, size cap, gallery cap) so a bad request is a clean
 * 400 here and `StorageValidationError` in the controller is reserved for genuine drift. No DB reads.
 */
export const validateCreateProductImageUploads = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const { files } = req.body as CreateProductImageUploadsRequestModel;

    if (!Array.isArray(files) || files.length === 0) {
      rejectUploads(res, "invalidFiles", { files });
      return;
    }
    if (files.length > appConfig.storage.maxImagesPerProduct) {
      rejectUploads(res, "tooManyFiles", {
        count: files.length,
        max: appConfig.storage.maxImagesPerProduct,
      });
      return;
    }

    const sanitizedFiles: ProductImageUploadFileModel[] = [];
    for (const file of files) {
      const contentType = file?.contentType;
      if (
        typeof contentType !== "string" ||
        !(contentType in appConfig.storage.allowedImageTypes)
      ) {
        rejectUploads(res, "invalidContentType", { contentType });
        return;
      }
      const contentLength = file.contentLength;
      if (
        typeof contentLength !== "number" ||
        !Number.isInteger(contentLength) ||
        contentLength <= 0 ||
        contentLength > appConfig.storage.maxUploadBytes
      ) {
        rejectUploads(res, "invalidContentLength", {
          contentLength,
          max: appConfig.storage.maxUploadBytes,
        });
        return;
      }
      sanitizedFiles.push({ contentType, contentLength });
    }

    const validatedBody: CreateProductImageUploadsRequestModel = {
      files: sanitizedFiles,
    };
    req.body = validatedBody;
    next();
  } catch (error) {
    logger.error(
      i18next.t("products.imageUploads.validators.logs.validationError", {
        error,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.imageUploads.validators.validationError"),
    );
  }
};

/**
 * `DELETE /products/:id` — the target must be an existing ACTIVE product; malformed and unknown
 * ids are both a plain `404` (the getProductById/update stance: there is nothing for the client
 * to "fix"). The deletion itself carries no body; the controller applies the no-trash policy.
 */
export const validateDeleteProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const productId = Number(req.params["id"]);
    const prismaClient = await getPrismaClient();
    const product =
      Number.isInteger(productId) && productId >= 1
        ? await prismaClient.product.findFirst({
            where: { id: productId, isActive: true },
            select: { id: true },
          })
        : null;
    if (!product) {
      logger.warn(
        i18next.t("products.deleteProduct.validators.logs.productNotFound", {
          id: req.params["id"],
        }),
      );
      sendOzariError(
        res,
        HttpEnum.NOT_FOUND,
        i18next.t("products.deleteProduct.validators.productNotFound"),
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
