import {
  CONTACT_EMAIL_REGEX,
  contactChannelKind,
  isValidContactPhone,
  ORDER_ADDRESS_MIN_LENGTH,
  ORDER_LONGTEXT_MAX_LENGTH,
  ORDER_TEXT_MAX_LENGTH,
  ORDER_TEXT_MIN_LENGTH,
} from '@constants/Regex';
import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { t } from 'i18next';
import { z } from 'zod';

const KEY = 'modules.panel.orders.registry.errors';

/** Hard bounds mirroring the backend (`clientRegistries.validator.ts`): ≥1 contact, 0..many
 *  addresses (a walk-in may type one per order), capped so a stuck row can't grow unboundedly. */
export const REGISTRY_MAX_CONTACTS = 10;
export const REGISTRY_MAX_ADDRESSES = 10;

const registryText = (min: number, max: number, requiredMessage: string, invalidMessage: string) =>
  z
    .string()
    .trim()
    .nonempty(requiredMessage)
    .refine((value) => value.length >= min && value.length <= max, invalidMessage);

const registryContactSchema = z.object({
  contactTypeId: z.number({ error: t(`${KEY}.requiredContactType`) }),
  value: registryText(
    ORDER_TEXT_MIN_LENGTH,
    ORDER_TEXT_MAX_LENGTH,
    t(`${KEY}.requiredContactValue`),
    t(`${KEY}.invalidContactValue`),
  ),
});

const registryAddressSchema = z.object({
  // `null` = the empty-selection sentinel: a zone is OPTIONAL (walk-ins are often outside the
  // seeded city zones — Hacienda Real). The encrypted address text carries the truth; the zone,
  // when set, drives the order form's delivery-fee suggestion.
  zoneId: z.number().nullable(),
  address: registryText(
    ORDER_ADDRESS_MIN_LENGTH,
    ORDER_LONGTEXT_MAX_LENGTH,
    t(`${KEY}.requiredAddress`),
    t(`${KEY}.invalidAddress`),
  ),
  // The OPTIONAL map pin. `null` is the empty sentinel (RHF ignores `undefined` on setValue), and
  // shape-only validation: the picker cannot produce an off-globe pair and the API re-checks.
  coords: z.object({ lat: z.number(), lng: z.number() }).nullable(),
});

/**
 * Mirrors the backend create-client-registry validator. The registry holds the responsible person
 * (loose 2–255 name — "Doña María la del canasto" is valid), ≥1 contact (exactly one principal),
 * 0..many addresses (exactly one favorite when any; a walk-in may have none and type the venue on
 * each order — Q-D), and an optional preferred payment method. "Exactly one principal/favorite" is a
 * UI invariant: a single selected INDEX per list, mapped to `isPrincipal`/`isFavorite` on submit
 * (the backend defaults the first if none is flagged).
 */
const baseCreateRegistrySchema = z.object({
  name: registryText(
    ORDER_TEXT_MIN_LENGTH,
    ORDER_TEXT_MAX_LENGTH,
    t(`${KEY}.requiredName`),
    t(`${KEY}.invalidName`),
  ),
  contacts: z
    .array(registryContactSchema)
    .min(1, t(`${KEY}.requiredContacts`))
    .max(REGISTRY_MAX_CONTACTS, t(`${KEY}.tooManyContacts`)),
  addresses: z.array(registryAddressSchema).max(REGISTRY_MAX_ADDRESSES, t(`${KEY}.tooManyAddresses`)),
  // The chosen principal contact / favorite address (a radio index). Out-of-range is harmless — the
  // backend defaults the first when nothing is flagged.
  principalContactIndex: z.number(),
  favoriteAddressIndex: z.number(),
  // `null` = no preference (the order's payment select then falls back to its own default).
  preferredPaymentMethodId: z.number().nullable(),
});

// Per-channel value shape: EMAIL must look like an email, WHATSAPP/PHONE like a phone number, OTHER
// is length-only (the base check). Mirrors the backend `clientRegistries.validator.ts`.
export const createRegistrySchema = baseCreateRegistrySchema.superRefine((data, ctx) => {
  data.contacts.forEach((contact, index) => {
    const value = contact.value.trim();
    if (value === '') return; // the base non-empty check already flags this
    const kind = contactChannelKind(contact.contactTypeId);
    if (kind === 'email' && !CONTACT_EMAIL_REGEX.test(value)) {
      ctx.addIssue({ code: 'custom', path: ['contacts', index, 'value'], message: t(`${KEY}.invalidEmail`) });
    } else if ((kind === 'whatsapp' || kind === 'phone') && !isValidContactPhone(value)) {
      ctx.addIssue({ code: 'custom', path: ['contacts', index, 'value'], message: t(`${KEY}.invalidPhone`) });
    }
  });
});

export type CreateRegistryFormType = z.infer<typeof createRegistrySchema>;

export const createRegistryDefaultValues: CreateRegistryFormType = {
  name: '',
  // Start with ONE empty contact (≥1 required) and ONE empty address (the common walk-in has a
  // venue; the admin can remove it for an address-less client).
  contacts: [{ contactTypeId: null as unknown as number, value: '' }],
  addresses: [{ zoneId: null, address: '', coords: null }],
  principalContactIndex: 0,
  favoriteAddressIndex: 0,
  preferredPaymentMethodId: null,
};

/** The `POST /client-registries` body — contacts/addresses with the chosen principal/favorite flags. */
export interface CreateRegistryBody {
  name: string;
  contacts: { contactTypeId: number; value: string; isPrincipal: boolean }[];
  addresses: {
    zoneId?: number;
    address: string;
    coords?: { lat: number; lng: number };
    isFavorite: boolean;
  }[];
  preferredPaymentMethodId?: number;
}

export function toCreateRegistryBody(data: CreateRegistryFormType): CreateRegistryBody {
  return {
    name: data.name.trim(),
    contacts: data.contacts.map((contact, index) => ({
      contactTypeId: contact.contactTypeId,
      value: contact.value.trim(),
      isPrincipal: index === data.principalContactIndex,
    })),
    addresses: data.addresses.map((address, index) => ({
      ...(address.zoneId != null && { zoneId: address.zoneId }),
      address: address.address.trim(),
      // Omitted when unset — the API treats absent and null the same, and most addresses have none.
      ...(address.coords && { coords: address.coords }),
      isFavorite: index === data.favoriteAddressIndex,
    })),
    ...(data.preferredPaymentMethodId != null && {
      preferredPaymentMethodId: data.preferredPaymentMethodId,
    }),
  };
}

export const createRegistryRequiredPatterns = getZodRequiredPatterns(baseCreateRegistrySchema);
