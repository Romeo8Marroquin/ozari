/**
 * `GET /preferences` — everything the admin preferences screen manages, in one call. The catalogs are
 * a handful of rows each (the whole payload is smaller than one page of products), so splitting them
 * across six endpoints would cost round-trips and buy nothing — the same stance as
 * `GET /orders/catalog`.
 */
export interface PreferencesResponseModel {
  settings: PreferenceSettingModel[];
  catalogs: PreferenceCatalogsResponseModel;
  /** Reference data a catalog FORM needs but the admin does not manage here (zones pick one). */
  municipalities: PreferenceCatalogRowModel[];
}

/**
 * One scalar setting, with the BOUNDS the API will enforce so the client can enforce the same ones
 * as the admin types. Deliberately no label or help text: those are copy, the frontend owns them
 * (the `colorKey` doctrine — the API ships tokens, never presentation).
 */
export interface PreferenceSettingModel {
  key: string;
  /** Always an integer today; the field exists so a future bool/text setting needs no new shape. */
  type: "int";
  value: number;
  min: number;
  max: number;
  /** Grouping token (`orders`, …) the screen lays its cards out by. */
  group: string;
}

/** `PUT /preferences/settings` — the FULL set, declarative like every other update in this codebase:
 *  what arrives is what the settings become. A partial body would make "unchanged" and "cleared"
 *  indistinguishable. */
export interface UpdatePreferenceSettingsRequestModel {
  settings: { key: string; value: number }[];
}

/**
 * One manageable catalog row, uniform across every catalog so the client renders them with ONE list
 * component. The extras are explicit rather than a generic bag: there are only three in the whole
 * system, and a typed field beats a `Record<string, unknown>` the client has to guess at.
 */
export interface PreferenceCatalogRowModel {
  id: number;
  name: string;
  description: string | undefined;
  isActive: boolean;
  /** Event types only — the client-side lead time (hours) before a delivery. */
  minLeadHours?: number;
  /** Zones only — the DEFAULT delivery fee for addresses in the zone (absent = not configured). */
  deliveryFee?: number;
  /** Zones only — which municipality the zone belongs to. */
  municipalityId?: number;
}

/**
 * A row as the SCREEN sees it: the stored fields plus whether anything currently points at it.
 *
 * `isReferenced` exists so the delete confirmation can promise the outcome it will actually get.
 * The conditional NO-TRASH rule means a delete either destroys the row or unpublishes it, and only
 * the database knows which — without this flag the dialog has to hedge ("it may be hidden instead"),
 * which is exactly the kind of copy that teaches an admin not to read dialogs. The server still
 * re-decides under the transaction that acts; this is the honest preview, not the authority.
 */
export interface PreferenceCatalogRowResponseModel extends PreferenceCatalogRowModel {
  isReferenced: boolean;
}

export interface PreferenceCatalogsResponseModel {
  eventTypes: PreferenceCatalogRowResponseModel[];
  contactTypes: PreferenceCatalogRowResponseModel[];
  zones: PreferenceCatalogRowResponseModel[];
  paymentMethods: PreferenceCatalogRowResponseModel[];
  productCategories: PreferenceCatalogRowResponseModel[];
  productDetailTypes: PreferenceCatalogRowResponseModel[];
}

/** A create/update body for any catalog — the validator narrows it to the fields THAT catalog
 *  declares, so an event type can never be sent a `deliveryFee`. */
export interface CatalogRowRequestModel {
  name: string;
  description: string | undefined;
  isActive: boolean;
  minLeadHours?: number;
  deliveryFee?: number | null;
  municipalityId?: number;
}

export interface PreferenceCatalogRowEnvelopeModel {
  row: PreferenceCatalogRowResponseModel;
}

/** `DELETE` outcome — the client's copy differs, so it is told WHICH of the two happened rather
 *  than having to re-fetch and infer it (the conditional NO-TRASH rule made observable). */
export interface DeleteCatalogRowResponseModel {
  /** `deleted` = nothing referenced it, the row is gone. `deactivated` = something does, so it was
   *  unpublished instead and existing records keep resolving their names. */
  outcome: "deleted" | "deactivated";
}
