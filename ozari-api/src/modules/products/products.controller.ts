import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { i18next } from "@/config/i18n.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { logger } from "@/config/logger.js";
import { AuditAction, logAudit } from "@/config/auditLogger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { getStorage, StorageValidationError } from "@helpers/storage.js";
import {
  type CreateProductImageUploadsRequestModel,
  type CreateProductRequestModel,
  type ProductCatalogResponseModel,
  type ProductDetailResponseModel,
  type ProductImageUploadsResponseModel,
  type ProductListResponseModel,
} from "./products.models.js";
import {
  buildPaginationMeta,
  buildProductImagesCreate,
  buildProductListWhere,
  parseProductListQuery,
  projectProductForRole,
  richProductInclude,
} from "./products.service.js";

/**
 * `GET /products` — the paginated product catalog. Available to **every authenticated role**; the
 * response is **role-projected** so each role sees only the fields it should (minimum privilege — the
 * exact stock count is Admin-only, an in-stock signal is Employee+, everything else is shared). Row
 * visibility is uniform (the active catalog); the role axis is the *fields* (`projectProductForRole`).
 * Optional filters (`search`/`categoryId`/`businessTypeId`, Employee+ `inStock`, Admin-only
 * `includeInactive`) narrow the rows; like the pagination params they clamp or drop, never 400.
 */
export const getProducts = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    // Role is DB-verified in verifyJwt; fall back to the least-privileged view if somehow absent.
    // The role feeds the parser too: `includeInactive` is honoured for Admin only.
    const role = req.user?.userRole ?? RolesEnum.Client;
    const query = parseProductListQuery(req.query, role);
    const { page, pageSize } = query;

    const prismaClient = await getPrismaClient();
    const where = buildProductListWhere(query);
    const [rawProducts, total] = await Promise.all([
      prismaClient.product.findMany({
        where,
        include: richProductInclude,
        // Newest first (oldest land at the bottom of the grid) — the DEFAULT order until admin
        // filters/custom ordering arrive. `id` tiebreaks same-timestamp rows so pagination pages
        // never shuffle.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prismaClient.product.count({ where }),
    ]);

    const response: ProductListResponseModel = {
      products: rawProducts.map((product) =>
        projectProductForRole(product, role),
      ),
      pagination: buildPaginationMeta(page, pageSize, total),
    };

    logger.info(
      i18next.t("products.getAllProducts.logs.productsFetched", {
        count: total,
      }),
    );
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("products.getAllProducts.productsFetched"),
      response,
    );
  } catch (error) {
    logger.error(
      i18next.t("products.getAllProducts.logs.errorFetchingProducts", {
        error,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.getAllProducts.errorFetchingProducts"),
    );
  }
};

/**
 * `GET /products/:id` — one product, the exact role-projected shape of a list item (same
 * `projectProductForRole`, so the field policy lives in ONE place). Row visibility matches the
 * list: the active catalog only (a soft-deleted product 404s for everyone until the 3b admin
 * tooling needs otherwise). A malformed id and an unknown id are both a plain **404** — a detail
 * lookup either finds the row or it doesn't; there is nothing for the client to "fix".
 */
export const getProductById = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const role = req.user?.userRole ?? RolesEnum.Client;
    const id = Number(req.params["id"]);
    const validId = Number.isInteger(id) && id >= 1;

    const prismaClient = await getPrismaClient();
    const rawProduct = validId
      ? await prismaClient.product.findFirst({
          where: {
            id,
            isActive: true,
            businessType: { isActive: true },
            category: { isActive: true },
            currency: { isActive: true },
          },
          include: richProductInclude,
        })
      : null;

    if (!rawProduct) {
      logger.warn(
        i18next.t("products.getProductById.logs.productNotFound", {
          id: req.params["id"],
        }),
      );
      sendOzariError(
        res,
        HttpEnum.NOT_FOUND,
        i18next.t("products.getProductById.productNotFound"),
      );
      return;
    }

    const response: ProductDetailResponseModel = {
      product: projectProductForRole(rawProduct, role),
    };
    logger.info(
      i18next.t("products.getProductById.logs.productFetched", { id }),
    );
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("products.getProductById.productFetched"),
      response,
    );
  } catch (error) {
    logger.error(
      i18next.t("products.getProductById.logs.errorFetchingProduct", {
        error,
      }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.getProductById.errorFetchingProduct"),
    );
  }
};

/**
 * `GET /products/catalog` — the seeded reference lists the create/edit form renders as selects
 * (business types, categories, currencies, rent time units, detail types), id + name only, active
 * rows, id order. Available to any authenticated role: it's public reference data (the names already
 * appear on every projected product) and employee-facing filters will consume it later.
 */
export const getProductCatalog = async (
  _req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const option = { where: { isActive: true }, orderBy: { id: "asc" }, select: { id: true, name: true } } as const;
    const [businessTypes, categories, currencies, detailTypes, rentTimeUnits] =
      await Promise.all([
        prismaClient.productBusinessType.findMany(option),
        prismaClient.productCategory.findMany(option),
        prismaClient.currency.findMany({
          ...option,
          select: { id: true, name: true, iso4217Code: true, symbol: true },
        }),
        prismaClient.productDetailType.findMany(option),
        prismaClient.rentTimeUnit.findMany(option),
      ]);

    const response: ProductCatalogResponseModel = {
      businessTypes,
      categories,
      currencies,
      detailTypes,
      rentTimeUnits,
    };

    logger.info(i18next.t("products.catalog.logs.catalogFetched"));
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("products.catalog.catalogFetched"),
      response,
    );
  } catch (error) {
    logger.error(
      i18next.t("products.catalog.logs.errorFetchingCatalog", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.catalog.errorFetchingCatalog"),
    );
  }
};

/** Prisma's unique-constraint violation (P2002) — here that's always `product_images.r2_key`. */
const isUniqueViolation = (
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** The violated column(s) for the log line (defensive: meta may be absent). */
const violationTarget = (error: Prisma.PrismaClientKnownRequestError): string =>
  ((error.meta?.["target"] as string[] | undefined) ?? []).join(",");

/**
 * `POST /products` — create a product (+ nested details). **Admin only** (`isGrantedRoles` on the
 * route; the validator has already enforced the conditional price rule and sanitized the body).
 * The response is the SAME role-projected item shape the list returns (`projectProductForRole`
 * over a `richProductInclude` fetch), so the frontend cache can absorb it without translation.
 * Gallery images arrive as R2 keys (already uploaded via the presigned flow); the public URL is
 * derived server-side from each key — a client-sent URL is never persisted.
 */
export const createProduct = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as CreateProductRequestModel;
    // Fail-closed like the reads: the route guarantees Admin, but never assume it here.
    const role = req.user?.userRole ?? RolesEnum.Client;

    // Gallery nested-create (or undefined): URLs derived server-side from the validated keys, and
    // storage is only touched when images exist (see `buildProductImagesCreate`).
    const productImages = buildProductImagesCreate(body.images);

    const prismaClient = await getPrismaClient();
    const created = await prismaClient.product.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        productBusinessTypeId: body.businessTypeId,
        productCategoryId: body.categoryId,
        currencyId: body.currencyId,
        quantity: body.quantity,
        rentPrice: body.rentPrice ?? null,
        sellPrice: body.sellPrice ?? null,
        replacementPrice: body.replacementPrice ?? null,
        rentTimeUnitId: body.rentTimeUnitId ?? null,
        ...(body.productDetails.length > 0 && {
          productDetails: {
            create: body.productDetails.map((detail) => ({
              productDetailTypeId: detail.detailTypeId,
              detail: detail.detail,
            })),
          },
        }),
        ...(productImages && { productImages }),
      },
      include: richProductInclude,
    });

    logger.info(
      i18next.t("products.createProduct.logs.productCreated", {
        id: created.id,
        name: created.name,
      }),
    );

    // Audit log: product created (deployed environments only, like every audit event).
    if (isDeployedEnvironment()) {
      logAudit({
        action: AuditAction.ADMIN_ACTION,
        ...(req.user && { userId: req.user.userId }),
        ...(req.ip && { ipAddress: req.ip }),
        resource: `Product ID ${created.id}`,
        success: true,
        metadata: { operation: "PRODUCT_CREATED" },
      });
    }

    sendOzariSuccess(
      res,
      HttpEnum.CREATED,
      i18next.t("products.createProduct.productCreated"),
      projectProductForRole(created, role),
    );
  } catch (error) {
    // The DB's unique guard on `product_images.r2_key`: replaying an R2 key that another image
    // row already owns is a semantic input error (a shared object would be double-deleted later),
    // not a server fault — surface it like the validator's own duplicate rule.
    if (isUniqueViolation(error)) {
      logger.warn(
        i18next.t("products.createProduct.validators.logs.duplicateImageKey", {
          key: violationTarget(error),
        }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.createProduct.validators.duplicateImageKey"),
      );
      return;
    }
    logger.error(
      i18next.t("products.createProduct.logs.errorCreatingProduct", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.createProduct.errorCreatingProduct"),
    );
  }
};

/**
 * `POST /products/images/upload-url` — mint presigned R2 PUT URLs for a product gallery upload.
 * **Admin only** (same guard as create — only an admin can attach images). The file bytes NEVER pass
 * through the API: the browser PUTs straight to R2 with the returned URL, then references the `key`
 * in `POST /products`. Content type + length are bound into each signature (see `R2Storage`), so a
 * minted URL can't be reused for a different file. The validator has already enforced the policy;
 * a `StorageValidationError` here means config drift and still maps to a clean 400.
 */
export const createProductImageUploads = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const { files } = req.body as CreateProductImageUploadsRequestModel;

    const storage = getStorage();
    const uploads = await Promise.all(
      files.map((file) =>
        storage.createUpload({
          kind: "product",
          contentType: file.contentType,
          contentLength: file.contentLength,
        }),
      ),
    );

    logger.info(
      i18next.t("products.imageUploads.logs.uploadsCreated", {
        count: uploads.length,
      }),
    );

    const response: ProductImageUploadsResponseModel = { uploads };
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("products.imageUploads.uploadsCreated"),
      response,
    );
  } catch (error) {
    if (error instanceof StorageValidationError) {
      logger.warn(
        i18next.t("products.imageUploads.logs.uploadPolicyViolation", {
          error,
        }),
      );
      sendOzariError(
        res,
        HttpEnum.BAD_REQUEST,
        i18next.t("products.imageUploads.validators.invalidFiles"),
      );
      return;
    }
    logger.error(
      i18next.t("products.imageUploads.logs.errorCreatingUploads", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.imageUploads.errorCreatingUploads"),
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WIP: update / delete are Admin-only writes, kept commented until they're rebuilt against the new
// Product shape (conditional pricing, fix-style detail updates, soft-delete cascade). Create is
// live above — follow its shape when rebuilding these.
//
// GALLERY ON UPDATE — the agreed RECONCILE design (owner decision, 2026-07-13). The client stages
// every gallery movement locally (add/remove/reorder/star = zero network) and, on save, sends the
// FINAL desired gallery declaratively, in display order: kept photos by `id`, new photos by `key`
// (already uploaded via the presign flow), exactly one primary. NOT an operation log. The backend
// computes the diff in ONE $transaction — kept → update sortOrder/isPrimary; rows absent from the
// list → delete; new keys → create (reuse `buildProductImagesCreate`'s url-derivation stance) —
// and only AFTER the commit best-effort-deletes the removed objects from R2 (`storage.deleteObject`,
// log failures, never fail the request; a failed tx must never orphan DB rows pointing at deleted
// files). Residual: a failed save between upload and update leaves stray R2 objects — bounded,
// sweepable by a cleanup job diffing the `products/` prefix against `product_images.r2_key`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// export const updateProduct = async (req, res) => { ... };
// export const deleteProduct = async (req, res) => { ... };
