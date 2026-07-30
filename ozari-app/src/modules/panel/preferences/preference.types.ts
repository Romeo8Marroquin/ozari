/** One scalar setting, with the BOUNDS the API enforces so this side can enforce the same ones as
 *  the admin types. No label or help text: that is copy, and this side owns it (per key, in i18n). */
export interface PreferenceSetting {
  key: string;
  type: 'int';
  value: number;
  min: number;
  max: number;
  /** Grouping token (`orders`, `evidence`) the screen lays its cards out by. */
  group: string;
}

/** A plain reference row a FORM picks from (the municipalities a zone belongs to). Not manageable
 *  here, so it carries no reference flag — there is no delete to describe. */
export interface LookupRow {
  id: number;
  name: string;
  description?: string;
  isActive: boolean;
}

/**
 * One manageable catalog row, uniform across every catalog so ONE list component renders them all.
 * The extras are explicit: only three exist in the whole system.
 */
export interface CatalogRow extends LookupRow {
  /** Event types only — the client-side lead time (hours) before a delivery. */
  minLeadHours?: number;
  /** Zones only. ABSENT = not configured, which is a different answer from 0 (free). */
  deliveryFee?: number;
  /** Zones only. */
  municipalityId?: number;
  /**
   * Does anything already point at this row? Lets the delete confirmation state the ACTUAL outcome —
   * destroyed, or unpublished so existing records keep resolving their names — instead of hedging
   * about both.
   *
   * REQUIRED, not optional: the API always sends it, and an optional flag would force a third set of
   * copy for a case that cannot happen (and that nobody could then keep truthful).
   *
   * The server re-decides under the transaction that acts, so this is an honest preview and the
   * response's `outcome` remains the authority.
   */
  isReferenced: boolean;
}

/** The url segment of every admin-manageable catalog. Anything else 404s — the backend registry
 *  deliberately excludes the lookups whose ids runtime code branches on. */
export type CatalogKey =
  | 'event-types'
  | 'contact-types'
  | 'zones'
  | 'payment-methods'
  | 'product-categories'
  | 'product-detail-types';

export interface PreferenceCatalogs {
  eventTypes: CatalogRow[];
  contactTypes: CatalogRow[];
  zones: CatalogRow[];
  paymentMethods: CatalogRow[];
  productCategories: CatalogRow[];
  productDetailTypes: CatalogRow[];
}

export interface PreferencesResponse {
  settings: PreferenceSetting[];
  catalogs: PreferenceCatalogs;
  /** Reference data the ZONE form picks from — not managed here. */
  municipalities: LookupRow[];
}

export interface PreferenceSettingsEnvelope {
  settings: PreferenceSetting[];
}

/** A catalog row's full state, as create/update send it. */
export interface CatalogRowBody {
  name: string;
  description?: string;
  isActive: boolean;
  minLeadHours?: number;
  deliveryFee?: number | null;
  municipalityId?: number;
}

export interface CatalogRowEnvelope {
  row: CatalogRow;
}

/** Which of the two doors a delete took — the conditional NO-TRASH rule, made observable so the
 *  toast can be truthful instead of vague. */
export interface DeleteCatalogRowResponse {
  outcome: 'deleted' | 'deactivated';
}
