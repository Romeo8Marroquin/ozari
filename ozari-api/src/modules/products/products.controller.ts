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
  type UpdateProductRequestModel,
} from "./products.models.js";
import {
  applyProductDelete,
  applyProductUpdate,
  buildPaginationMeta,
  buildProductImagesCreate,
  buildProductListWhere,
  buildRentedNowWhere,
  parseProductListQuery,
  ProductStateConflictError,
  productSortSelect,
  projectProductForRole,
  rentProductIds,
  richProductInclude,
  sortProductIdPage,
  type RichProduct,
} from "./products.service.js";

/**
 * Units of each RENT product currently out on active rentals (`buildRentedNowWhere` is the business
 * rule), keyed by product id. Venta products are skipped (their `quantity` IS the availability) and
 * so is the query itself when the page has no rentals. Products without active rentals simply have
 * no entry — callers default to 0.
 */
const loadRentedNowByProductId = async (
  products: ReadonlyArray<Pick<RichProduct, "id" | "productBusinessTypeId">>,
): Promise<Map<number, number>> => {
  const ids = rentProductIds(products);
  if (ids.length === 0) {
    return new Map();
  }
  const prismaClient = await getPrismaClient();
  const grouped = await prismaClient.serviceDetail.groupBy({
    by: ["productId"],
    where: buildRentedNowWhere(ids, new Date()),
    _sum: { quantity: true },
  });
  return new Map(grouped.map((row) => [row.productId, row._sum.quantity ?? 0]));
};

/**
 * `GET /products` — the paginated product catalog. **Admin + Client only** (route guard — a Driver
 * gets 403, Epic-2A); the response is **role-projected** so each role sees only the fields it
 * should (minimum privilege — the availability fields are Admin-only, everything else is shared). Row
 * visibility is uniform (the active catalog); the role axis is the *fields* (`projectProductForRole`).
 * Optional filters (`search`/`categoryId`/`businessTypeId`, Admin-only `includeInactive`) narrow the
 * rows and `sort` orders them; like the pagination params they clamp or drop, never 400.
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
    const { page, pageSize, sort } = query;

    const prismaClient = await getPrismaClient();
    const where = buildProductListWhere(query);

    let rawProducts: RichProduct[];
    let total: number;
    if (sort === "recent") {
      // The default order lives in SQL: newest first (oldest land at the bottom of the grid),
      // `id` tiebreaking same-timestamp rows so pagination pages never shuffle.
      [rawProducts, total] = await Promise.all([
        prismaClient.product.findMany({
          where,
          include: richProductInclude,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prismaClient.product.count({ where }),
      ]);
    } else {
      // Name/price orders need the Spanish collation / COALESCE — the in-memory id-page path
      // (see `sortProductIdPage`): fetch the filtered set minimally, order + slice, then fetch
      // the page rich. The minimal fetch doubles as the count.
      const sortRows = await prismaClient.product.findMany({
        where,
        select: productSortSelect,
      });
      total = sortRows.length;
      const pageIds = sortProductIdPage(sortRows, sort, page, pageSize);
      const unordered =
        pageIds.length > 0
          ? await prismaClient.product.findMany({
              where: { id: { in: pageIds } },
              include: richProductInclude,
            })
          : [];
      const byId = new Map(unordered.map((product) => [product.id, product]));
      // The id-page order is authoritative; a row deleted between the two reads drops out cleanly.
      rawProducts = pageIds.flatMap((id) => {
        const product = byId.get(id);
        return product ? [product] : [];
      });
    }

    // Derived availability: what each rental has OUT right now (one grouped query for the page).
    const rentedNow = await loadRentedNowByProductId(rawProducts);

    const response: ProductListResponseModel = {
      products: rawProducts.map((product) =>
        projectProductForRole(product, role, rentedNow.get(product.id) ?? 0),
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

    const rentedNow = await loadRentedNowByProductId([rawProduct]);
    const response: ProductDetailResponseModel = {
      product: projectProductForRole(
        rawProduct,
        role,
        rentedNow.get(rawProduct.id) ?? 0,
      ),
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
 * rows, id order. Admin + Client (the products-read guard): it's public reference data (the names
 * already appear on every projected product) and the client-facing filters consume it too.
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

/**
 * `PUT /products/:id` — the declarative full-state update, the RECONCILE design (owner decision,
 * 2026-07-13). **Admin only** (route guard). The client stages every gallery/detail movement
 * locally and sends the FINAL desired state; the validator has already enforced the create rules +
 * ownership, and `applyProductUpdate` diffs it against the live rows in ONE `$transaction` (kept →
 * update, absent → delete, new → create). Removed R2 objects are deleted best-effort only AFTER
 * the commit — a rolled-back save can never orphan DB rows pointing at deleted files. Residual: a
 * save that fails between upload and update leaves stray R2 objects — bounded, sweepable by a
 * cleanup job diffing the `products/` prefix against `product_images.r2_key` (EPIC-1 §5).
 *
 * A kept id that vanished mid-save (another admin's concurrent edit) is a clean **409** — the
 * client reloads and retries; a replayed R2 key another image owns is the same **400** as create.
 * The response is the role-projected product, fetched INSIDE the transaction (the committed state).
 */
export const updateProduct = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as UpdateProductRequestModel;
    const role = req.user?.userRole ?? RolesEnum.Client;
    // The validator already resolved this to an existing active product.
    const id = Number(req.params["id"]);

    const prismaClient = await getPrismaClient();
    const { removedImageKeys, updated } = await prismaClient.$transaction(
      async (tx) => {
        const reconciled = await applyProductUpdate(tx, id, body);
        return {
          removedImageKeys: reconciled.removedImageKeys,
          updated: await tx.product.findUniqueOrThrow({
            where: { id },
            include: richProductInclude,
          }),
        };
      },
    );

    // Post-commit, best-effort R2 cleanup: the DB rows are already gone, so a failed object delete
    // only leaves a stray file (swept later) — it must NEVER fail the request. Awaited on purpose
    // (Cloud Run only allocates CPU during the request; fire-and-forget would silently drop it).
    if (removedImageKeys.length > 0) {
      const storage = getStorage();
      await Promise.all(
        removedImageKeys.map(async (key) => {
          try {
            await storage.deleteObject(key);
          } catch (cleanupError) {
            logger.warn(
              i18next.t("products.updateProduct.logs.imageCleanupFailed", {
                key,
                error: cleanupError,
              }),
            );
          }
        }),
      );
    }

    logger.info(
      i18next.t("products.updateProduct.logs.productUpdated", { id }),
    );

    // Audit log: product updated (deployed environments only, like every audit event).
    if (isDeployedEnvironment()) {
      logAudit({
        action: AuditAction.ADMIN_ACTION,
        ...(req.user && { userId: req.user.userId }),
        ...(req.ip && { ipAddress: req.ip }),
        resource: `Product ID ${id}`,
        success: true,
        metadata: { operation: "PRODUCT_UPDATED" },
      });
    }

    const rentedNow = await loadRentedNowByProductId([updated]);
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("products.updateProduct.productUpdated"),
      projectProductForRole(updated, role, rentedNow.get(id) ?? 0),
    );
  } catch (error) {
    // A kept image/detail id vanished between the validator's read and the transaction — another
    // admin's save/delete won the race. The transaction rolled back; the client reloads and retries.
    if (error instanceof ProductStateConflictError) {
      logger.warn(
        i18next.t("products.updateProduct.logs.conflict", { error }),
      );
      sendOzariError(
        res,
        HttpEnum.CONFLICT,
        i18next.t("products.updateProduct.conflict"),
      );
      return;
    }
    // Same DB guard as create: a new key that another image row already owns.
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
      i18next.t("products.updateProduct.logs.genericError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.updateProduct.genericError"),
    );
  }
};

/**
 * `DELETE /products/:id` — **Admin only** (route guard). The NO-TRASH policy (owner decision,
 * 2026-07-15): the product row survives as a soft-deleted tombstone ONLY when order history
 * references it (`service_details` rows — erasing it would falsify past orders); otherwise the row
 * is hard-deleted. Its details and gallery rows are hard-deleted either way, in ONE `$transaction`
 * (`applyProductDelete`), and the gallery's R2 objects are removed AFTER the commit in one batched
 * call — best-effort, like update's cleanup: a failed object delete only leaves a sweepable stray,
 * never a failed request or a DB row pointing at a deleted file.
 */
export const deleteProduct = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    // The validator already resolved this to an existing active product.
    const id = Number(req.params["id"]);

    const prismaClient = await getPrismaClient();
    const { removedImageKeys, hardDeleted } = await prismaClient.$transaction(
      (tx) => applyProductDelete(tx, id),
    );

    // Post-commit, batched, best-effort R2 cleanup (see the doc above). Awaited on purpose —
    // Cloud Run only allocates CPU during the request; fire-and-forget would silently drop it.
    if (removedImageKeys.length > 0) {
      try {
        await getStorage().deleteObjects(removedImageKeys);
      } catch (cleanupError) {
        logger.warn(
          i18next.t("products.deleteProduct.logs.imageCleanupFailed", {
            count: removedImageKeys.length,
            error: cleanupError,
          }),
        );
      }
    }

    logger.info(
      i18next.t(
        hardDeleted
          ? "products.deleteProduct.logs.productDeleted"
          : "products.deleteProduct.logs.productDeactivated",
        { id },
      ),
    );

    // Audit log: product deleted (deployed environments only, like every audit event).
    if (isDeployedEnvironment()) {
      logAudit({
        action: AuditAction.ADMIN_ACTION,
        ...(req.user && { userId: req.user.userId }),
        ...(req.ip && { ipAddress: req.ip }),
        resource: `Product ID ${id}`,
        success: true,
        metadata: {
          operation: "PRODUCT_DELETED",
          mode: hardDeleted ? "HARD" : "SOFT",
        },
      });
    }

    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("products.deleteProduct.productDeleted"),
    );
  } catch (error) {
    logger.error(
      i18next.t("products.deleteProduct.logs.genericError", { error }),
    );
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("products.deleteProduct.genericError"),
    );
  }
};
