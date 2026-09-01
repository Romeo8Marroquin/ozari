import { useTranslation } from 'react-i18next';
import { usePreferences } from '../preferences/usePreferences';
import { readLetterhead } from './documentModel';
import type { DocumentBankAccount, DocumentKind, DocumentLetterhead } from './documentModel';
import type { DocumentCopy } from './OrderDocument';

const KEY = 'modules.panel.documents';

/**
 * The vocabulary and the letterhead both documents share.
 *
 * Extracted the moment there were two callers (2026-08-26). "One template, so the two documents can
 * never drift into looking like different companies" (EPIC-2-DOCUMENTS §4) is only half true while
 * each button assembles its own forty-leaf copy object: the layout would match and the WORDS would
 * not. A comprobante calling a column `Cantidad` and a cotización calling it `Cant.` is exactly the
 * drift the shared template exists to prevent.
 *
 * `kind` picks the title and nothing else — the same rule the template follows.
 */
export function useDocumentCopy(kind: DocumentKind): DocumentCopy {
  const { t } = useTranslation();
  return {
    title: t(`${KEY}.${kind === 'quote' ? 'quote' : 'receipt'}.title`),
    reference: t(`${KEY}.fields.reference`),
    issuedAt: t(`${KEY}.fields.issuedAt`),
    validUntil: t(`${KEY}.fields.validUntil`),
    paid: t(`${KEY}.fields.paid`),
    quoteNotice: t(`${KEY}.notices.quote`),
    termsNotice: t(`${KEY}.notices.terms`),
    phonePrefix: t(`${KEY}.fields.phonePrefix`),
    clientCard: t(`${KEY}.fields.clientCard`),
    clientName: t(`${KEY}.fields.clientName`),
    contact: t(`${KEY}.fields.contact`),
    address: t(`${KEY}.fields.address`),
    eventCard: t(`${KEY}.fields.eventCard`),
    eventType: t(`${KEY}.fields.eventType`),
    delivery: t(`${KEY}.fields.delivery`),
    pickup: t(`${KEY}.fields.pickup`),
    billedDays: t(`${KEY}.fields.billedDays`),
    // Pluralised through i18next rather than by appending a unit: "1 días" is the kind of slip that
    // makes a client wonder what else on the page was assembled by string concatenation.
    billedDaysValue: (days) => t(`${KEY}.fields.billedDaysValue`, { count: days }),
    billedDaysHint: t(`${KEY}.fields.billedDaysHint`),
    groupRental: t(`${KEY}.groups.rental`),
    groupSale: t(`${KEY}.groups.sale`),
    columnDescription: t(`${KEY}.columns.description`),
    columnQuantity: t(`${KEY}.columns.quantity`),
    columnDays: t(`${KEY}.columns.days`),
    columnDailyPrice: t(`${KEY}.columns.dailyPrice`),
    columnUnitPrice: t(`${KEY}.columns.unitPrice`),
    columnLineTotal: t(`${KEY}.columns.lineTotal`),
    subtotal: t(`${KEY}.totals.subtotal`),
    deliveryFee: t(`${KEY}.totals.delivery`),
    deliveryIncludesReturn: t(`${KEY}.totals.deliveryIncludesReturn`),
    deliveryIncludesOneWay: t(`${KEY}.totals.deliveryIncludesOneWay`),
    free: t(`${KEY}.totals.free`),
    discount: t(`${KEY}.totals.discount`),
    total: t(`${KEY}.totals.total`),
    deposit: t(`${KEY}.totals.deposit`),
    balance: t(`${KEY}.totals.balance`),
    conditions: t(`${KEY}.fields.conditions`),
    banks: t(`${KEY}.fields.banks`),
    page: (page, total) => t(`${KEY}.fields.page`, { page, total }),
  };
}

/**
 * The business's letterhead, from the preferences the admin already filled in.
 *
 * That query is Admin-only and `staleTime: Infinity`, which is fine because both document actions
 * are Admin-only too. A letterhead we could not read is a THINNER document, never a broken button:
 * `readLetterhead` resolves every missing key to its empty value, and the figures — the part the
 * admin actually asked for — do not come from preferences at all.
 */
export function useDocumentLetterhead(): DocumentLetterhead {
  const { data } = usePreferences();
  const banks: DocumentBankAccount[] = (data?.catalogs.bankAccounts ?? [])
    // Unpublished accounts are configuration the admin has retired — printing one would invite a
    // deposit into an account the business no longer watches.
    .filter((row) => row.isActive)
    .map((row) => ({
      name: row.name,
      bankKey: row.bankKey ?? null,
      accountType: row.accountType ?? '',
      accountNumber: row.accountNumber ?? '',
      holder: row.holder ?? '',
    }));
  return readLetterhead(data?.settings ?? [], banks);
}
