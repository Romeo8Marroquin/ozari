import { useTranslation } from 'react-i18next';
import { usePreferences } from '../preferences/usePreferences';
import { readLetterhead } from './documentModel';
import type { DocumentBankAccount, DocumentKind, DocumentLetterhead } from './documentModel';
import type { DamageReportCopy, DocumentChromeCopy, DocumentCopy } from './OrderDocument';

const KEY = 'modules.panel.documents';

type Translate = ReturnType<typeof useTranslation>['t'];

/** The words every document's frame and shared blocks print — ONE source, so the comprobante and
 *  the damage report cannot label the same card, column or page number differently. */
function chromeCopy(t: Translate, title: string): DocumentChromeCopy {
  return {
    title,
    reference: t(`${KEY}.fields.reference`),
    issuedAt: t(`${KEY}.fields.issuedAt`),
    phonePrefix: t(`${KEY}.fields.phonePrefix`),
    clientCard: t(`${KEY}.fields.clientCard`),
    clientName: t(`${KEY}.fields.clientName`),
    contact: t(`${KEY}.fields.contact`),
    address: t(`${KEY}.fields.address`),
    eventCard: t(`${KEY}.fields.eventCard`),
    eventType: t(`${KEY}.fields.eventType`),
    delivery: t(`${KEY}.fields.delivery`),
    pickup: t(`${KEY}.fields.pickup`),
    columnQuantity: t(`${KEY}.columns.quantity`),
    columnLineTotal: t(`${KEY}.columns.lineTotal`),
    banks: t(`${KEY}.fields.banks`),
    page: (page, total) => t(`${KEY}.fields.page`, { page, total }),
    balance: {
      depositDue: t(`${KEY}.balance.depositDue`),
      depositDueNote: t(`${KEY}.balance.depositDueNote`),
      claims: t(`${KEY}.balance.claims`),
      claimsNote: t(`${KEY}.balance.claimsNote`),
      depositCredit: t(`${KEY}.balance.depositCredit`),
      serviceDue: t(`${KEY}.balance.serviceDue`),
      advanceCredit: t(`${KEY}.balance.advanceCredit`),
      collect: t(`${KEY}.balance.collect`),
      refund: t(`${KEY}.balance.refund`),
      none: t(`${KEY}.balance.none`),
      depositOnHand: t(`${KEY}.balance.depositOnHand`),
      depositOnHandNote: t(`${KEY}.balance.depositOnHandNote`),
    },
  };
}

/**
 * The vocabulary and the letterhead every document shares.
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
    ...chromeCopy(t, t(`${KEY}.${kind === 'quote' ? 'quote' : 'receipt'}.title`)),
    validUntil: t(`${KEY}.fields.validUntil`),
    paid: t(`${KEY}.fields.paid`),
    quoteNotice: t(`${KEY}.notices.quote`),
    termsNotice: t(`${KEY}.notices.terms`),
    billedDays: t(`${KEY}.fields.billedDays`),
    // Pluralised through i18next rather than by appending a unit: "1 días" is the kind of slip that
    // makes a client wonder what else on the page was assembled by string concatenation.
    billedDaysValue: (days) => t(`${KEY}.fields.billedDaysValue`, { count: days }),
    billedDaysHint: t(`${KEY}.fields.billedDaysHint`),
    groupRental: t(`${KEY}.groups.rental`),
    groupSale: t(`${KEY}.groups.sale`),
    columnDescription: t(`${KEY}.columns.description`),
    columnDays: t(`${KEY}.columns.days`),
    columnDailyPrice: t(`${KEY}.columns.dailyPrice`),
    columnUnitPrice: t(`${KEY}.columns.unitPrice`),
    subtotal: t(`${KEY}.totals.subtotal`),
    deliveryFee: t(`${KEY}.totals.delivery`),
    deliveryIncludesReturn: t(`${KEY}.totals.deliveryIncludesReturn`),
    deliveryIncludesOneWay: t(`${KEY}.totals.deliveryIncludesOneWay`),
    free: t(`${KEY}.totals.free`),
    discount: t(`${KEY}.totals.discount`),
    total: t(`${KEY}.totals.total`),
    advance: t(`${KEY}.totals.advance`),
    advanceReceived: (amount) => t(`${KEY}.totals.advanceReceived`, { amount }),
    paidAmount: t(`${KEY}.totals.paid`),
    settlementTitle: t(`${KEY}.securityDeposit.settlementTitle`),
    damagesTitle: t(`${KEY}.securityDeposit.damagesTitle`),
    settlementRetention: t(`${KEY}.securityDeposit.retention`),
    settlementReplacement: (product) => t(`${KEY}.securityDeposit.replacement`, { product }),
    settlementReplacementDetail: (quantity, unitAmount) =>
      t(`${KEY}.securityDeposit.replacementDetail`, { quantity, unitAmount }),
    settlementClaimsTotal: t(`${KEY}.securityDeposit.claimsTotal`),
    conditions: t(`${KEY}.fields.conditions`),
  };
}

/**
 * The damage report's vocabulary (EPIC-2-DOCUMENTS §2c) — the shared frame words plus its own.
 * The client's word is "Depósito", never "garantía" or "liquidación" (owner, 2026-10-27).
 */
export function useDamageReportCopy(): DamageReportCopy {
  const { t } = useTranslation();
  const report = `${KEY}.damageReport`;
  return {
    ...chromeCopy(t, t(`${report}.title`)),
    depositTitle: t(`${report}.depositTitle`),
    columnProduct: t(`${report}.columns.product`),
    columnDepositEach: t(`${report}.columns.depositEach`),
    retentionTitle: t(`${report}.retentionTitle`),
    retentionNoReason: t(`${report}.retentionNoReason`),
    replacementsTitle: t(`${report}.replacementsTitle`),
    columnUnits: t(`${report}.columns.units`),
    columnReplacementEach: t(`${report}.columns.replacementEach`),
    noClaims: t(`${report}.noClaims`),
    noClaimsNoDeposit: t(`${report}.noClaimsNoDeposit`),
    claimsTotal: t(`${report}.totals.claims`),
    claimsBreakdown: (retained, damages) =>
      t(`${report}.totals.claimsBreakdown`, { retained, damages }),
    payTitle: t(`${report}.payTitle`),
    payLead: t(`${report}.payLead`),
  };
}

/**
 * The business's letterhead, from the preferences the admin already filled in.
 *
 * That query is Admin-only and `staleTime: Infinity`, which is fine because every document action
 * is Admin-only too. A letterhead we could not read is a THINNER document, never a broken button:
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
