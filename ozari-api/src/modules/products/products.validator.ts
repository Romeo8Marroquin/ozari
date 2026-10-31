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
  type UpdateProductDisplayOrderRequestModel,
  type UpdateProductImageRequestModel,
  type UpdateProductRequestModel,
} from "./products.models.js";
import {
  buildProductImageKeyRegex,
  parseProductVariations,
  sanitizeOptionalMoney,
  securityDepositViolation,
  type ExistingProductVariations,
  type ParsedProductVariations,
  type ProductVariationsBody,
  type RejectVariation,
} from "./products.variations.js";

/** The variations parser's rejection, in its own namespace (shared by create and update). */
const rejectVariationWith =
  (res: Response): RejectVariation =>
  (key, logParams) => {
    logger.warn(i18next.t(`products.variations.validators.logs.${key}`, logParams));
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t(`products.variations.validators.${key}`),
    );
  };

/**
 * The stock rule both doors share once the variations are parsed: a product whose variants own
 * their stock keeps it on each variant (the parser already refused a `quantity` —
 * `quantityWithVariants`) and stores 0; one without options, or with SHARED stock, must carry its
 * own valid `quantity` (the one pool). `null` = rejected.
 */
const resolveProductQuantity = (
  res: Response,
  variations: ParsedProductVariations,
  quantity: unknown,
): number | null => {
  if (variations.options.length > 0 && !variations.sharedStock) {
    return 0;
  }
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 0 ||
    quantity > appConfig.maxGlobalQuantity
  ) {
    rejectCreate(res, "invalidQuantity", { quantity });
    return null;
  }
  return quantity;
};

/**
 * Both doors' variations step: the shared parser over the request + the already-sanitized scalars
 * (`existing` = the product's ids today, `null` on create), then the stock rule it decides. `null` =
 * rejected (the 400 is already sent).
 */
const parseVariationsAndStock = (
  res: Response,
  body: Record<string, unknown>,
  scalars: Pick<
    ProductVariationsBody,
    "isRent" | "rentPrice" | "sellPrice" | "replacementPrice" | "securityDeposit" | "showcaseImages"
  >,
  existing: ExistingProductVariations | null,
): { variations: ParsedProductVariations; quantity: number } | null => {
  const variations = parseProductVariations(
    {
      options: body["options"],
      variants: body["variants"],
      quantity: body["quantity"],
      sharedStock: body["sharedStock"],
      ...scalars,
    },
    existing,
    rejectVariationWith(res),
  );
  if (!variations) {
    return null;
  }
  const quantity = resolveProductQuantity(res, variations, body["quantity"]);
  return quantity === null ? null : { variations, quantity };
};

/**
 * The four optional money fields both doors sanitize (present ⇒ a number in range, truncated to
 * cents), each rejecting with its own create key. `null` = rejected (the 400 is already sent).
 */
const sanitizeProductMoney = (
  res: Response,
  raw: { rentPrice: unknown; sellPrice: unknown; replacementPrice: unknown; securityDeposit: unknown },
): Record<"rentMoney" | "sellMoney" | "replacementMoney" | "depositMoney", { value: number | undefined }> | null => {
  const fields = [
    ["rentMoney", "rentPrice", "invalidRentPrice"],
    ["sellMoney", "sellPrice", "invalidSellPrice"],
    ["replacementMoney", "replacementPrice", "invalidReplacementPrice"],
    ["depositMoney", "securityDeposit", "invalidSecurityDeposit"],
  ] as const;
  const sanitized = {} as Record<(typeof fields)[number][0], { value: number | undefined }>;
  for (const [target, field, key] of fields) {
    const result = sanitizeOptionalMoney(raw[field]);
    if (!result.ok) {
      rejectCreate(res, key, { [field]: raw[field] });
      return null;
    }
    sanitized[target] = result;
  }
  return sanitized;
};

/** Whether the body declares variation options — the product's own price is then only a DEFAULT
 *  (each variant must resolve one; the variations parser enforces that). A malformed `options` is
 *  the parser's 400 to send, so it counts as none here. */
const declaresOptions = (body: Record<string, unknown>): boolean =>
  Array.isArray(body["options"]) && body["options"].length > 0;

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
      rentPrice,
      rentTimeUnitId,
      replacementPrice,
      securityDeposit,
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

    const money = sanitizeProductMoney(res, { rentPrice, sellPrice, replacementPrice, securityDeposit });
    if (!money) {
      return;
    }
    const { rentMoney, sellMoney, replacementMoney, depositMoney } = money;

    // The CONDITIONAL price rule — a product is exactly ONE business type:
    // Alquiler → rentPrice + a valid rent time unit, sellPrice forbidden; Venta → sellPrice only,
    // rent fields forbidden. `replacementPrice` is Alquiler-only too (what a client pays for a
    // lost/damaged RENTAL — a sold item is simply consumed, there is nothing to replace). With
    // variation options the price is only the DEFAULT the variants inherit (owner 2026-10-30): it
    // may be absent, and the parser makes every variant resolve one (`variantPriceRequired`).
    const isRent = businessTypeId === BusinessTypeEnum.RENT;
    const hasRentTimeUnit =
      rentTimeUnitId !== undefined && rentTimeUnitId !== null;
    const pricingParams = { businessTypeId, rentPrice, sellPrice, rentTimeUnitId };
    const priceIsDefault = declaresOptions(req.body as Record<string, unknown>);
    if (isRent) {
      if (sellMoney.value !== undefined) {
        rejectCreate(res, "pricingMismatch", pricingParams);
        return;
      }
      if (rentMoney.value === undefined && !priceIsDefault) {
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
      if (sellMoney.value === undefined && !priceIsDefault) {
        rejectCreate(res, "sellPricingRequired", { sellPrice });
        return;
      }
      if (replacementMoney.value !== undefined) {
        rejectCreate(res, "replacementPriceForbidden", { replacementPrice });
        return;
      }
    }
    const depositViolation = securityDepositViolation(isRent, depositMoney.value, replacementMoney.value);
    if (depositViolation) {
      rejectCreate(res, depositViolation, { securityDeposit, replacementPrice });
      return;
    }

    // Variations — the shared parser (create: every id forbidden), then the stock rule they decide.
    const parsed = parseVariationsAndStock(
      res,
      req.body as Record<string, unknown>,
      {
        isRent,
        rentPrice: isRent ? rentMoney.value : undefined,
        sellPrice: isRent ? undefined : sellMoney.value,
        replacementPrice: isRent ? replacementMoney.value : undefined,
        securityDeposit: depositMoney.value,
        showcaseImages: sanitizedImages,
      },
      null,
    );
    if (!parsed) {
      return;
    }
    const { variations, quantity: resolvedQuantity } = parsed;

    const validatedBody: CreateProductRequestModel = {
      businessTypeId,
      categoryId,
      currencyId,
      description: description?.trim() ? description.trim() : undefined,
      images: sanitizedImages,
      name: name.trim(),
      productDetails: sanitizedProductDetails,
      quantity: resolvedQuantity,
      options: variations.options,
      variants: variations.variants,
      sharedStock: variations.sharedStock,
      rentPrice: isRent ? rentMoney.value : undefined,
      rentTimeUnitId: isRent ? rentTimeUnitId : undefined,
      replacementPrice: isRent ? replacementMoney.value : undefined,
      securityDeposit: depositMoney.value,
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
 * The update's target product: a malformed id and an unknown/soft-deleted product are both `null`
 * (→ 404) — a detail lookup either finds the row or it doesn't (the getProductById stance).
 */
const findUpdateTarget = async (
  prismaClient: Awaited<ReturnType<typeof getPrismaClient>>,
  rawId: unknown,
) => {
  const productId = Number(rawId);
  if (!Number.isInteger(productId) || productId < 1) {
    return null;
  }
  return prismaClient.product.findFirst({
    where: { id: productId, isActive: true },
    select: {
      id: true,
      // EVERY photo of the product (any set): a kept photo may move between sets.
      productImages: { select: { id: true } },
      productDetails: { select: { id: true } },
      options: { select: { id: true, values: { select: { id: true } } } },
      variants: { where: { isActive: true }, select: { id: true } },
    },
  });
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
      rentPrice,
      rentTimeUnitId,
      replacementPrice,
      securityDeposit,
      sellPrice,
    } = req.body as UpdateProductRequestModel;

    const prismaClient = await getPrismaClient();
    const product = await findUpdateTarget(prismaClient, req.params["id"]);
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

    const money = sanitizeProductMoney(res, { rentPrice, sellPrice, replacementPrice, securityDeposit });
    if (!money) {
      return;
    }
    const { rentMoney, sellMoney, replacementMoney, depositMoney } = money;

    // The CONDITIONAL price rule — identical to create (a product is exactly ONE business type),
    // and it applies to the product's NEW type: switching Alquiler → Venta must arrive with the
    // Venta shape (the reconcile then nulls the now-irrelevant columns).
    const isRent = businessTypeId === BusinessTypeEnum.RENT;
    const hasRentTimeUnit =
      rentTimeUnitId !== undefined && rentTimeUnitId !== null;
    const pricingParams = { businessTypeId, rentPrice, sellPrice, rentTimeUnitId };
    const priceIsDefault = declaresOptions(req.body as Record<string, unknown>);
    if (isRent) {
      if (sellMoney.value !== undefined) {
        rejectCreate(res, "pricingMismatch", pricingParams);
        return;
      }
      if (rentMoney.value === undefined && !priceIsDefault) {
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
      if (sellMoney.value === undefined && !priceIsDefault) {
        rejectCreate(res, "sellPricingRequired", { sellPrice });
        return;
      }
      if (replacementMoney.value !== undefined) {
        rejectCreate(res, "replacementPriceForbidden", { replacementPrice });
        return;
      }
    }
    const depositViolation = securityDepositViolation(isRent, depositMoney.value, replacementMoney.value);
    if (depositViolation) {
      rejectCreate(res, depositViolation, { securityDeposit, replacementPrice });
      return;
    }

    // Variations — the SAME parser as create, told what the product has today (ownership of every
    // kept option/value/variant/photo id is checked against it; the transaction re-verifies).
    const parsed = parseVariationsAndStock(
      res,
      req.body as Record<string, unknown>,
      {
        isRent,
        rentPrice: isRent ? rentMoney.value : undefined,
        sellPrice: isRent ? undefined : sellMoney.value,
        replacementPrice: isRent ? replacementMoney.value : undefined,
        securityDeposit: depositMoney.value,
        showcaseImages: sanitizedImages,
      },
      {
        imageIds: product.productImages.map((image) => image.id),
        options: product.options,
        activeVariantIds: product.variants.map((variant) => variant.id),
      },
    );
    if (!parsed) {
      return;
    }
    const { variations, quantity: resolvedQuantity } = parsed;

    const validatedBody: UpdateProductRequestModel = {
      businessTypeId,
      categoryId,
      currencyId,
      description: description?.trim() ? description.trim() : undefined,
      images: sanitizedImages,
      name: name.trim(),
      productDetails: sanitizedProductDetails,
      quantity: resolvedQuantity,
      options: variations.options,
      variants: variations.variants,
      sharedStock: variations.sharedStock,
      rentPrice: isRent ? rentMoney.value : undefined,
      rentTimeUnitId: isRent ? rentTimeUnitId : undefined,
      replacementPrice: isRent ? replacementMoney.value : undefined,
      securityDeposit: depositMoney.value,
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
    // One save's uploads in ONE presign call: every set of a product (showcase + each value's).
    if (files.length > appConfig.storage.maxImagesTotalPerProduct) {
      rejectUploads(res, "tooManyFiles", {
        count: files.length,
        max: appConfig.storage.maxImagesTotalPerProduct,
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
 * `PUT /products/display-order` body: `{ productIds }` — a non-empty array of DISTINCT positive
 * integers, at most `maxArrangedProducts`. Shape only, no DB read: whether the list is exactly the
 * active catalog is checked INSIDE the transaction (a 409 there), where it cannot go stale.
 */
export const validateUpdateProductDisplayOrder = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { productIds } = (req.body ?? {}) as Partial<UpdateProductDisplayOrderRequestModel>;
  const wellFormed =
    Array.isArray(productIds) &&
    productIds.length > 0 &&
    productIds.length <= appConfig.maxArrangedProducts &&
    productIds.every((id) => Number.isInteger(id) && id >= 1) &&
    new Set(productIds).size === productIds.length;
  if (!wellFormed) {
    logger.warn(
      i18next.t("products.displayOrder.validators.logs.invalidProductIds", {
        count: Array.isArray(productIds) ? productIds.length : undefined,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.BAD_REQUEST,
      i18next.t("products.displayOrder.validators.invalidProductIds"),
    );
    return;
  }
  const validatedBody: UpdateProductDisplayOrderRequestModel = { productIds };
  req.body = validatedBody;
  next();
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
