import type { Response } from "express";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { isDeployedEnvironment } from "@/config/environment.js";
import { AuditAction, logAudit } from "@/config/auditLogger.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import type { CustomRequest } from "@models/common/customRequestModel.js";
import {
  CATALOG_RESPONSE_KEYS,
  PREFERENCE_CATALOGS,
  catalogByKey,
  isRowReferenced,
  referencedIdsOf,
  type CatalogClient,
  type CatalogDefinition,
} from "./preferences.catalogs.js";
import {
  loadSettings,
  PreferenceInvariantError,
  PreferenceNotFoundError,
  writeSettings,
} from "./preferences.service.js";
import type {
  CatalogRowRequestModel,
  DeleteCatalogRowResponseModel,
  PreferenceCatalogRowEnvelopeModel,
  PreferenceCatalogsResponseModel,
  PreferencesResponseModel,
  UpdatePreferenceSettingsRequestModel,
} from "./preferences.models.js";

/** Audit every write here: these rows change how the whole business behaves, so "who changed the
 *  spacing rule" has to be answerable. Deployed-only, like every other audit call. */
const audit = (req: CustomRequest, resource: string, operation: string): void => {
  if (!isDeployedEnvironment()) {
    return;
  }
  logAudit({
    action: AuditAction.ADMIN_ACTION,
    ...(req.user && { userId: req.user.userId }),
    ...(req.ip && { ipAddress: req.ip }),
    resource,
    success: true,
    metadata: { operation },
  });
};

/** The `:catalog` segment → its definition, or a 404 (see the validator's note on why 404). */
const resolveCatalog = (req: CustomRequest, res: Response): CatalogDefinition | null => {
  const catalog = catalogByKey(String(req.params["catalog"]));
  if (!catalog) {
    logger.warn(
      i18next.t("preferences.catalogs.logs.unknownCatalog", { catalog: req.params["catalog"] }),
    );
    sendOzariError(res, HttpEnum.NOT_FOUND, i18next.t("preferences.catalogs.unknownCatalog"));
    return null;
  }
  return catalog;
};

/** A `:id` param → a positive integer, or `null` (answered as a 404 by the caller). */
const parseId = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 ? id : null;
};

/**
 * Every manageable catalog's rows, each tagged with whether anything points at it.
 *
 * The whole thing is ONE parallel batch: six list queries and eight reference `GROUP BY`s fire
 * together, so the endpoint costs about one round-trip's latency rather than fourteen. Keep it that
 * way — awaiting a catalog before starting the next is the one change that would make this screen
 * feel slow.
 */
const loadCatalogs = async (
  client: CatalogClient,
): Promise<PreferenceCatalogsResponseModel> => {
  const entries = await Promise.all(
    CATALOG_RESPONSE_KEYS.map(async ([responseKey, key]) => {
      const catalog = PREFERENCE_CATALOGS[key];
      const [rows, referenced] = await Promise.all([
        catalog.list(client),
        referencedIdsOf(catalog, client),
      ]);
      return [
        responseKey,
        rows.map((row) => ({ ...row, isReferenced: referenced.has(row.id) })),
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as PreferenceCatalogsResponseModel;
};

/**
 * `GET /preferences` — **Admin only.** Everything the preferences screen manages in one call: the
 * editable scalar settings (with the bounds the client mirrors while typing) plus every manageable
 * catalog's rows, INCLUDING the unpublished ones — this is the screen where `isActive` is edited, so
 * hiding inactive rows here would make them unrecoverable.
 *
 * `municipalities` rides along because the zone form needs to pick one; it is reference data the
 * admin does NOT manage here (see the registry's note on why the geo tables are not catalogs).
 */
export const getPreferences = async (
  _req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const prismaClient = await getPrismaClient();
    const [settings, municipalities, catalogs] = await Promise.all([
      loadSettings(prismaClient),
      prismaClient.municipality
        .findMany({
          where: { isActive: true },
          select: { id: true, name: true, description: true, isActive: true },
          orderBy: { name: "asc" },
        })
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description ?? undefined,
            isActive: row.isActive,
          })),
        ),
      loadCatalogs(prismaClient),
    ]);

    const response: PreferencesResponseModel = { settings, catalogs, municipalities };
    logger.info(i18next.t("preferences.getPreferences.logs.preferencesFetched"));
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t("preferences.getPreferences.preferencesFetched"),
      response,
    );
  } catch (error) {
    logger.error(i18next.t("preferences.getPreferences.logs.errorFetching", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("preferences.getPreferences.errorFetching"),
    );
  }
};

/**
 * `PUT /preferences/settings` — **Admin only.** Writes the validated set and answers with the RELOADED
 * settings, so the client renders what the system will actually read rather than what it just sent
 * (a clamped or upserted value would otherwise diverge silently).
 */
export const updatePreferenceSettings = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as UpdatePreferenceSettingsRequestModel;
    const prismaClient = await getPrismaClient();
    await writeSettings(prismaClient, body.settings);
    const settings = await loadSettings(prismaClient);

    logger.info(
      i18next.t("preferences.updateSettings.logs.settingsUpdated", {
        keys: body.settings.map((setting) => setting.key).join(", "),
      }),
    );
    audit(req, "App preferences", "PREFERENCES_UPDATED");
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("preferences.updateSettings.settingsUpdated"), {
      settings,
    });
  } catch (error) {
    logger.error(i18next.t("preferences.updateSettings.logs.errorUpdating", { error }));
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("preferences.updateSettings.errorUpdating"),
    );
  }
};

/** `POST /preferences/catalogs/:catalog` — **Admin only.** Adds a row to a manageable catalog. */
export const createCatalogRow = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const catalog = resolveCatalog(req, res);
    if (!catalog) {
      return;
    }
    const prismaClient = await getPrismaClient();
    const created = await catalog.create(prismaClient, req.body as CatalogRowRequestModel);
    // A row that did not exist a moment ago cannot be referenced — no query needed to know it.
    const row = { ...created, isReferenced: false };
    const response: PreferenceCatalogRowEnvelopeModel = { row };

    logger.info(
      i18next.t("preferences.catalogs.logs.rowCreated", {
        catalog: req.params["catalog"],
        id: row.id,
      }),
    );
    audit(req, `Catalog ${req.params["catalog"]} row ${row.id}`, "CATALOG_ROW_CREATED");
    sendOzariSuccess(res, HttpEnum.CREATED, i18next.t("preferences.catalogs.rowCreated"), response);
  } catch (error) {
    logger.error(i18next.t("preferences.catalogs.logs.errorCreating", { error }));
    sendOzariError(res, HttpEnum.INTERNAL_SERVER_ERROR, i18next.t("preferences.catalogs.errorCreating"));
  }
};

/**
 * `PUT /preferences/catalogs/:catalog/:id` — **Admin only.** Full-state row update.
 *
 * The one invariant: a catalog the forms depend on may not be left with **zero active rows**
 * (`minimumActive`). Unpublishing the last event type wouldn't just look odd — it puts the order form
 * into its `config` dead-end, which is a worse outcome than refusing the edit, and much harder to
 * diagnose from the other side.
 */
export const updateCatalogRow = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const catalog = resolveCatalog(req, res);
    if (!catalog) {
      return;
    }
    const id = parseId(String(req.params["id"]));
    if (id === null) {
      throw new PreferenceNotFoundError();
    }
    const body = req.body as CatalogRowRequestModel;
    const prismaClient = await getPrismaClient();

    const row = await prismaClient.$transaction(async (tx) => {
      const existing = await catalog.find(tx, id);
      if (!existing) {
        throw new PreferenceNotFoundError();
      }
      // Only a transition from published to unpublished can strand the forms.
      if (existing.isActive && !body.isActive) {
        const active = await catalog.countActive(tx);
        if (active <= catalog.minimumActive) {
          throw new PreferenceInvariantError("lastActive");
        }
      }
      const updated = await catalog.update(tx, id, body);
      // Renaming or unpublishing a row changes nothing about who points at it, but the client
      // replaces its cached row wholesale — so the flag has to travel with it or the delete dialog
      // would revert to hedging after any edit.
      return { ...updated, isReferenced: await isRowReferenced(catalog, tx, id) };
    });

    logger.info(
      i18next.t("preferences.catalogs.logs.rowUpdated", { catalog: req.params["catalog"], id }),
    );
    audit(req, `Catalog ${req.params["catalog"]} row ${id}`, "CATALOG_ROW_UPDATED");
    const response: PreferenceCatalogRowEnvelopeModel = { row };
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("preferences.catalogs.rowUpdated"), response);
  } catch (error) {
    if (answeredCatalogError(req, res, error)) {
      return;
    }
    logger.error(i18next.t("preferences.catalogs.logs.errorUpdating", { error }));
    sendOzariError(res, HttpEnum.INTERNAL_SERVER_ERROR, i18next.t("preferences.catalogs.errorUpdating"));
  }
};

/**
 * `DELETE /preferences/catalogs/:catalog/:id` — **Admin only.** The conditional NO-TRASH rule, applied
 * to reference data: the row **hard-deletes** when nothing points at it, and **deactivates** when
 * something does — an order holds a live FK to its event type, so destroying a used row would leave
 * its detail page unable to name it. The response says WHICH happened so the client's copy can be
 * truthful instead of vague.
 *
 * The same `minimumActive` invariant as the update applies: the last active row of a catalog the
 * forms need cannot be removed by either door.
 */
export const deleteCatalogRow = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const catalog = resolveCatalog(req, res);
    if (!catalog) {
      return;
    }
    const id = parseId(String(req.params["id"]));
    if (id === null) {
      throw new PreferenceNotFoundError();
    }
    const prismaClient = await getPrismaClient();

    const outcome = await prismaClient.$transaction(async (tx) => {
      const existing = await catalog.find(tx, id);
      if (!existing) {
        throw new PreferenceNotFoundError();
      }
      if (existing.isActive) {
        const active = await catalog.countActive(tx);
        if (active <= catalog.minimumActive) {
          throw new PreferenceInvariantError("lastActive");
        }
      }
      if (await isRowReferenced(catalog, tx, id)) {
        await catalog.deactivate(tx, id);
        return "deactivated" as const;
      }
      await catalog.remove(tx, id);
      return "deleted" as const;
    });

    logger.info(
      i18next.t(`preferences.catalogs.logs.row${outcome === "deleted" ? "Deleted" : "Deactivated"}`, {
        catalog: req.params["catalog"],
        id,
      }),
    );
    audit(req, `Catalog ${req.params["catalog"]} row ${id}`, `CATALOG_ROW_${outcome.toUpperCase()}`);
    const response: DeleteCatalogRowResponseModel = { outcome };
    sendOzariSuccess(
      res,
      HttpEnum.OK,
      i18next.t(`preferences.catalogs.${outcome === "deleted" ? "rowDeleted" : "rowDeactivated"}`),
      response,
    );
  } catch (error) {
    if (answeredCatalogError(req, res, error)) {
      return;
    }
    logger.error(i18next.t("preferences.catalogs.logs.errorDeleting", { error }));
    sendOzariError(res, HttpEnum.INTERNAL_SERVER_ERROR, i18next.t("preferences.catalogs.errorDeleting"));
  }
};

/** The two typed failures both row endpoints share. Returns `true` once it has answered. */
function answeredCatalogError(req: CustomRequest, res: Response, error: unknown): boolean {
  if (error instanceof PreferenceNotFoundError) {
    logger.warn(
      i18next.t("preferences.catalogs.logs.rowNotFound", {
        catalog: req.params["catalog"],
        id: req.params["id"],
      }),
    );
    sendOzariError(res, HttpEnum.NOT_FOUND, i18next.t("preferences.catalogs.rowNotFound"));
    return true;
  }
  if (error instanceof PreferenceInvariantError) {
    logger.warn(
      i18next.t("preferences.catalogs.logs.lastActive", { catalog: req.params["catalog"] }),
    );
    sendOzariError(res, HttpEnum.CONFLICT, i18next.t("preferences.catalogs.lastActive"));
    return true;
  }
  return false;
}
