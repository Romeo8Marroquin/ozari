import {
  FULLNAME_REGEX,
  PRODUCT_DESCRIPTION_REGEX,
  PRODUCT_MAX_AMOUNT,
  PRODUCT_MAX_QUANTITY,
} from '@constants/Regex';
import getZodRequiredPatterns from '@utils/getZodRequiredPatterns';
import { t } from 'i18next';
import { z } from 'zod';

const KEY = 'modules.panel.products.create.errors';

/** Business type ids — mirror the backend `BusinessTypeEnum` (seeded lookup, stable ids). */
export const BUSINESS_TYPE_RENT = 1;
export const BUSINESS_TYPE_SELL = 2;
/** Default rent period ("Día") and currency (GTQ) — the seeded defaults the form opens with. */
export const DEFAULT_RENT_TIME_UNIT_ID = 2;
export const DEFAULT_CURRENCY_ID = 1;

/**
 * Parses a MONEY text-input value: `''` = absent; otherwise it must be a plain non-negative number
 * within the global ceiling. Returns the parsed number, `undefined` when absent, or `null` when
 * present-but-invalid (the schema turns `null` into a field error).
 */
export const parseMoney = (value: string): number | undefined | null => {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > PRODUCT_MAX_AMOUNT) return null;
  return parsed;
};

/** Parses the QUANTITY text-input value: a required integer within `[0, PRODUCT_MAX_QUANTITY]`. */
export const parseQuantity = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > PRODUCT_MAX_QUANTITY) return null;
  return parsed;
};

const moneyField = (invalidMessage: string) =>
  z.string().refine((value) => parseMoney(value) !== null, invalidMessage);

/**
 * Mirrors the backend create-product validator (`ozari-api/.../products.validator.ts`): both sides
 * must accept and reject exactly the same values — the backend is the security boundary, this is
 * the UX mirror. Numeric TEXT inputs (prices, quantity) are kept as strings in the form and parsed
 * here + mapped to numbers on submit (`toCreateProductBody`); selects hold numeric ids directly.
 *
 * Split base/refine like the other schemas: `getZodRequiredPatterns` needs the plain `ZodObject`.
 */
const baseCreateProductSchema = z.object({
  name: z
    .string()
    .trim()
    .nonempty(t(`${KEY}.requiredName`))
    .refine((value) => FULLNAME_REGEX.test(value), t(`${KEY}.invalidName`)),
  description: z
    .string()
    .refine(
      (value) => value.trim() === '' || PRODUCT_DESCRIPTION_REGEX.test(value.trim()),
      t(`${KEY}.invalidDescription`),
    )
    .optional(),
  businessTypeId: z.number({ error: t(`${KEY}.requiredBusinessType`) }),
  categoryId: z.number({ error: t(`${KEY}.requiredCategory`) }),
  currencyId: z.number({ error: t(`${KEY}.requiredCurrency`) }),
  quantity: z.string().refine((value) => parseQuantity(value) !== null, t(`${KEY}.invalidQuantity`)),
  rentPrice: moneyField(t(`${KEY}.invalidRentPrice`)).optional(),
  // `null` = the empty-selection sentinel (see CustomSelectForm) — the conditional rule below
  // enforces presence for Alquiler; a bare `.optional()` would reject the sentinel outright.
  rentTimeUnitId: z.number().nullable().optional(),
  replacementPrice: moneyField(t(`${KEY}.invalidReplacementPrice`)).optional(),
  sellPrice: moneyField(t(`${KEY}.invalidSellPrice`)).optional(),
  details: z.array(
    z.object({
      detailTypeId: z.number({ error: t(`${KEY}.requiredDetailType`) }),
      detail: z
        .string()
        .trim()
        .nonempty(t(`${KEY}.requiredDetail`))
        .refine((value) => FULLNAME_REGEX.test(value), t(`${KEY}.invalidDetail`)),
    }),
  ),
});

// The CONDITIONAL price rule (same as the backend): Alquiler → rentPrice + rent unit, no
// sellPrice; Venta → sellPrice only. The UI clears the irrelevant fields on a type switch, so a
// violation here means stale state — the message lands on the missing/forbidden field. Also the
// ONE-DETAIL-PER-TYPE rule (a table can't have two "Color"s — mirrored from the backend); the UI
// already filters used types out of each row's options, so a duplicate here means a stale draft.
export const createProductSchema = baseCreateProductSchema.superRefine((data, ctx) => {
  const seenDetailTypes = new Set<number>();
  data.details.forEach((row, index) => {
    /* v8 ignore next -- defensive: Zod only runs refinements once the base schema (which already
       requires a numeric detailTypeId) passed, so a non-number can't reach here */
    if (typeof row.detailTypeId !== 'number') return;
    if (seenDetailTypes.has(row.detailTypeId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['details', index, 'detailTypeId'],
        message: t(`${KEY}.duplicateDetailType`),
      });
      return;
    }
    seenDetailTypes.add(row.detailTypeId);
  });
  const rent = parseMoney(data.rentPrice ?? '');
  const sell = parseMoney(data.sellPrice ?? '');
  if (data.businessTypeId === BUSINESS_TYPE_RENT) {
    if (rent === undefined) {
      ctx.addIssue({ code: 'custom', path: ['rentPrice'], message: t(`${KEY}.requiredRentPrice`) });
    }
    if (data.rentTimeUnitId === undefined || data.rentTimeUnitId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['rentTimeUnitId'],
        message: t(`${KEY}.requiredRentTimeUnit`),
      });
    }
    if (sell !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['sellPrice'], message: t(`${KEY}.forbiddenSellPrice`) });
    }
  } else if (data.businessTypeId === BUSINESS_TYPE_SELL) {
    if (sell === undefined) {
      ctx.addIssue({ code: 'custom', path: ['sellPrice'], message: t(`${KEY}.requiredSellPrice`) });
    }
    if (rent !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['rentPrice'], message: t(`${KEY}.forbiddenRentPrice`) });
    }
  }
});

export type CreateProductFormType = z.infer<typeof createProductSchema>;

export const createProductDefaultValues: CreateProductFormType = {
  name: '',
  description: '',
  businessTypeId: BUSINESS_TYPE_RENT,
  categoryId: null as unknown as number, // null = the category select opens on its placeholder
  currencyId: DEFAULT_CURRENCY_ID,
  quantity: '',
  rentPrice: '',
  rentTimeUnitId: DEFAULT_RENT_TIME_UNIT_ID,
  replacementPrice: '',
  sellPrice: '',
  details: [],
};

/** A gallery reference for the create body: an R2 key from the presign flow + the primary flag. */
export interface CreateProductImageRef {
  key: string;
  isPrimary: boolean;
}

/** The `POST /products` body — numbers where the API wants numbers, absent fields omitted. */
export interface CreateProductBody {
  name: string;
  description?: string;
  businessTypeId: number;
  categoryId: number;
  currencyId: number;
  quantity: number;
  rentPrice?: number;
  rentTimeUnitId?: number;
  replacementPrice?: number;
  sellPrice?: number;
  productDetails: { detailTypeId: number; detail: string }[];
  /** Uploaded gallery photos (array order = display order). Omitted when there are none. */
  images?: CreateProductImageRef[];
}

/** Maps the validated form values to the API body (money truncated to 2 decimals, like the backend). */
export function toCreateProductBody(data: CreateProductFormType): CreateProductBody {
  const money = (value: string | undefined): number | undefined => {
    const parsed = parseMoney(value ?? '');
    return parsed === undefined || parsed === null
      ? undefined
      : Math.trunc(parsed * 100) / 100;
  };
  const isRent = data.businessTypeId === BUSINESS_TYPE_RENT;
  const description = data.description?.trim();
  return {
    name: data.name.trim(),
    ...(description && { description }),
    businessTypeId: data.businessTypeId,
    categoryId: data.categoryId,
    currencyId: data.currencyId,
    quantity: parseQuantity(data.quantity) ?? 0,
    ...(isRent && { rentPrice: money(data.rentPrice), rentTimeUnitId: data.rentTimeUnitId ?? undefined }),
    ...(!isRent && { sellPrice: money(data.sellPrice) }),
    ...(money(data.replacementPrice) !== undefined && {
      replacementPrice: money(data.replacementPrice),
    }),
    productDetails: data.details.map((row) => ({
      detailTypeId: row.detailTypeId,
      detail: row.detail.trim(),
    })),
  };
}

export const createProductRequiredPatterns = getZodRequiredPatterns(baseCreateProductSchema);
