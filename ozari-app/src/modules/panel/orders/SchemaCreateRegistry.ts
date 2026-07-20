import {
  ORDER_ADDRESS_MIN_LENGTH,
  ORDER_LONGTEXT_MAX_LENGTH,
  ORDER_TEXT_MAX_LENGTH,
  ORDER_TEXT_MIN_LENGTH,
} from '@constants/Regex';
import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { t } from 'i18next';
import { z } from 'zod';

const KEY = 'modules.panel.orders.registry.errors';

/**
 * Mirrors the backend create-client-registry validator. **First-version scope:** ONE contact and
 * ONE address (the common walk-in: a phone and a place) — the backend accepts 1–10 of each and
 * defaults the first to principal/favorite, so this sends arrays of one. Multiple contacts/
 * addresses are a documented fast-follow (the model + API already support them). A registry "name"
 * is deliberately loose (any 2–255 chars — "Doña María la del canasto" is valid).
 */
const baseCreateRegistrySchema = z.object({
  name: z
    .string()
    .trim()
    .nonempty(t(`${KEY}.requiredName`))
    .refine(
      (v) => v.length >= ORDER_TEXT_MIN_LENGTH && v.length <= ORDER_TEXT_MAX_LENGTH,
      t(`${KEY}.invalidName`),
    ),
  contactTypeId: z.number({ error: t(`${KEY}.requiredContactType`) }),
  contactValue: z
    .string()
    .trim()
    .nonempty(t(`${KEY}.requiredContactValue`))
    .refine(
      (v) => v.length >= ORDER_TEXT_MIN_LENGTH && v.length <= ORDER_TEXT_MAX_LENGTH,
      t(`${KEY}.invalidContactValue`),
    ),
  // `null` = the empty-selection sentinel: a zone is OPTIONAL (walk-ins are often outside the
  // seeded city zones — Hacienda Real). The encrypted address text carries the truth.
  zoneId: z.number().nullable().optional(),
  address: z
    .string()
    .trim()
    .nonempty(t(`${KEY}.requiredAddress`))
    .refine(
      (v) => v.length >= ORDER_ADDRESS_MIN_LENGTH && v.length <= ORDER_LONGTEXT_MAX_LENGTH,
      t(`${KEY}.invalidAddress`),
    ),
});

export const createRegistrySchema = baseCreateRegistrySchema;

export type CreateRegistryFormType = z.infer<typeof createRegistrySchema>;

export const createRegistryDefaultValues: CreateRegistryFormType = {
  name: '',
  contactTypeId: null as unknown as number,
  contactValue: '',
  zoneId: null,
  address: '',
};

/** The `POST /client-registries` body — the single contact/address wrapped as arrays of one. */
export interface CreateRegistryBody {
  name: string;
  contacts: { contactTypeId: number; value: string; isPrincipal: boolean }[];
  addresses: { zoneId?: number; address: string; isFavorite: boolean }[];
}

export function toCreateRegistryBody(data: CreateRegistryFormType): CreateRegistryBody {
  return {
    name: data.name.trim(),
    contacts: [{ contactTypeId: data.contactTypeId, value: data.contactValue.trim(), isPrincipal: true }],
    addresses: [
      {
        ...(data.zoneId != null && { zoneId: data.zoneId }),
        address: data.address.trim(),
        isFavorite: true,
      },
    ],
  };
}

export const createRegistryRequiredPatterns = getZodRequiredPatterns(baseCreateRegistrySchema);
