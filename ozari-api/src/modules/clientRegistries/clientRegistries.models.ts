import type {
  CatalogOptionModel,
  PaginationMeta,
  ZoneCatalogOptionModel,
} from "../products/products.models.js";

/** One contact method of a registry as the create body carries it. */
export interface CreateRegistryContactRequestModel {
  contactTypeId: number;
  value: string;
  /** At most ONE may be true; when none is flagged the FIRST contact becomes principal. */
  isPrincipal?: boolean;
}

/** One delivery address as the create body carries it. `zoneId` is optional — walk-ins are often
 *  outside the seeded city zones (e.g. Hacienda Real); the text carries the truth. */
export interface CreateRegistryAddressRequestModel {
  zoneId?: number;
  address: string;
  instructions?: string;
  /** Suggested delivery fee for this address (the order snapshots what was actually charged). */
  domicilePrice?: number;
  /** At most ONE may be true; when none is flagged the FIRST address becomes the favorite. */
  isFavorite?: boolean;
}

/**
 * `POST /client-registries` — a WALK-IN client record (owner decision 2026-07-16, EPIC-2-ORDERS
 * §9): the responsible person the admin's WhatsApp/phone orders belong to. Requires ≥1 contact and
 * allows 0..many addresses (exactly one principal/favorite each — defaulted, never ambiguous; a
 * walk-in may have no saved venue and type one per order). Deliberately NOT
 * a user account: if this person later registers on the platform, the admin deletes the registry
 * (conditional NO-TRASH — orders keep their snapshots) and the client keeps ordering informally or
 * through their account, whichever they prefer.
 */
export interface CreateClientRegistryRequestModel {
  name: string;
  notes: string | undefined;
  contacts: CreateRegistryContactRequestModel[];
  addresses: CreateRegistryAddressRequestModel[];
  /** The client's DEFAULT payment method (pre-selects the order's method); optional. */
  preferredPaymentMethodId: number | undefined;
}

export interface RegistryContactResponseModel {
  id: number;
  contactType: CatalogOptionModel;
  value: string;
  isPrincipal: boolean;
}

export interface RegistryAddressResponseModel {
  id: number;
  zone: ZoneCatalogOptionModel | undefined;
  address: string;
  instructions: string | undefined;
  domicilePrice: number | undefined;
  isFavorite: boolean;
}

/** A registry as the admin's picker/list renders it — everything decrypted. */
export interface ClientRegistryResponseModel {
  id: number;
  name: string;
  notes: string | undefined;
  contacts: RegistryContactResponseModel[];
  addresses: RegistryAddressResponseModel[];
  /** The client's default payment method (pre-selects the order's method); `undefined` if unset. */
  preferredPaymentMethod: CatalogOptionModel | undefined;
  createdAt: Date;
}

export interface ClientRegistryListResponseModel {
  registries: ClientRegistryResponseModel[];
  pagination: PaginationMeta;
}

/** The `POST` payload envelope (mirrors orders' `{ order: … }` convention). */
export interface ClientRegistryEnvelopeModel {
  registry: ClientRegistryResponseModel;
}
