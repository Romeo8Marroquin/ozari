import {
  computeBilledDays,
  estimateLineSubtotal,
  isRentalProduct,
  lineUnitPrice,
} from '../orders/orderEstimate';
import { parseDateTime, parseLineQuantity, parseMoney } from '../orders/SchemaCreateOrder';
import type { CreateOrderFormType } from '../orders/SchemaCreateOrder';
import { squareOrderBalance } from '../orders/orderBalance';
import type { OrderBalance, OrderBalanceInput } from '../orders/orderBalance';
import type {
  OrderDamage,
  OrderDepositSettlement,
  OrderDetail,
  OrderLine,
} from '../orders/order.types';
import type { Product } from '../products/product.types';
import { primaryImageUrl } from '../products/productPresentation';
import { effectivePricing, lineDisplayName, variantFor } from '../products/productVariations';
import type { PreferenceSetting } from '../preferences/preference.types';

/** A day, for the quote's validity window. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * THE DOCUMENT MODEL — the only thing a document template ever reads (EPIC-2-DOCUMENTS §4).
 *
 * One model, two adapters: `fromOrderDetail` builds a **comprobante** from a saved order's stored
 * figures, and (Phase 2) `fromOrderForm` will build a **cotización** from the form's estimate. One
 * template consumes both, so the two documents can never drift into looking like different
 * companies. The adapters are pure functions, which is also where the tests live — the react-pdf
 * components are visual and coverage-excluded, like `leafletMap`.
 *
 * `kind` drives COPY only — the title, the "sujeta a cambios" note, the PAGADO mark. **No component
 * branches on it for layout**: if the two documents ever need different structure, that is a new
 * field here, not an `if` in the template.
 */
export type DocumentKind = 'receipt' | 'quote';

/** The business's own identity, from the `documents.*` preferences. */
export interface DocumentLetterhead {
  businessName: string;
  businessPhone: string;
  /** Whether the business HAS written terms — the document never transcribes them, it prints an
   *  acceptance line referring to them, and omits even that when there are none (§5). */
  hasTerms: boolean;
  /**
   * The short conditions the document DOES print, one per line, already split and trimmed.
   *
   * Not a softening of "the terms are referenced, never transcribed" (§5) but the other half of it
   * (owner decision 2026-08-25): the reason a wall of conditions does not belong on a quote is that
   * it buries the totals, not that the client should have to ask what happens if a table comes back
   * broken. Two or three lines in the business's own words state the things that change what the
   * client owes; the acceptance line still points at the full text for everything else.
   */
  conditions: string[];
  /**
   * The line stating that this delivery costs nothing — printed ONLY when the fee really is zero.
   *
   * The CONDITION is derived and the WORDING is the admin's, which is the only honest split
   * available: an order stores no zone (`deliveryZoneId` lives in the form as a fee suggester and is
   * never sent), so the document cannot name where free delivery applies — but it knows exactly
   * whether THIS order was charged for one. Typing the promise into `conditions` instead would print
   * it on billed orders too, which is the failure this exists to prevent.
   */
  freeDeliveryNote: string;
  quoteValidityDays: number;
  banks: DocumentBankAccount[];
}

export interface DocumentBankAccount {
  /** What the admin called it — "Banrural monetaria". */
  name: string;
  bankKey: string | null;
  accountType: string;
  accountNumber: string;
  holder: string;
}

/**
 * A row's product photo, printed as a small thumbnail beside its description (2026-10-29). Absent
 * when the product has none — and, once `embedDocumentImages` has run, absent too when the photo
 * could not be fetched: the document never fails over a picture. Before embedding it is the
 * catalog's URL; the template only ever receives a `data:` URI, so react-pdf never touches the network.
 */
export interface DocumentLineImage {
  imageUrl?: string;
}

/** One priced row of a group. `days` is present only where it changes the arithmetic (rentals). */
export interface DocumentLine extends DocumentLineImage {
  description: string;
  quantity: number;
  unitPrice: number;
  days?: number;
  total: number;
}

/** A titled group with its own columns and subtotal. A group with no lines is never built at all —
 *  the template must never have to render an empty table under a heading. */
export interface DocumentGroup {
  kind: 'rental' | 'sale';
  lines: DocumentLine[];
  subtotal: number;
}

export interface DocumentTotals {
  groups: { kind: DocumentGroup['kind']; subtotal: number }[];
  /** Absent when there is no delivery charge at all; 0 renders as "Gratis", which is a real answer. */
  delivery?: number;
  discount?: number;
  /** The service COST — never includes the deposit, and never zeroed: a receipt claiming a total of
   *  Q0.00 would be evidence that nothing was ever charged. */
  total: number;
  /** The part of the ANTICIPO (`OrderDetail.depositAmount` — the advance, NOT the security deposit)
   *  that went to the service: the whole anticipo, or the TOTAL when it was larger. Absent when none
   *  was taken. */
  advance?: number;
  /**
   * The anticipo as RECEIVED, present only when it exceeded the TOTAL — the caption under the
   * `Anticipo` row. Its excess is the squared box's `Saldo a favor del cliente` (`advanceCredit`) on
   * an unpaid order; printing the whole anticipo AND that row would subtract the excess twice.
   */
  advanceReceived?: number;
  /**
   * A PAID order: what the payment settled after the anticipo — the row that lets `TOTAL − anticipo
   * − pagado` reach the result on paper, instead of a saldo that silently drops to zero. Absent when
   * unpaid, or when the anticipo already covered the total.
   */
  paid?: number;
  /**
   * The order SQUARED (`squareOrderBalance`, EPIC-2-DOCUMENTS §2b): the deposit due or credited, the
   * damages, and the ONE amount that has to change hands and which way. The same function the order
   * page uses, so a document and the screen can never show two different outcomes.
   */
  balance: OrderBalance;
  /**
   * AFTER the damage report, the order's deposit was NOT received (pending, or recorded as not
   * received): nothing was credited, so the damages are billed whole — and the box says so under
   * its result (owner, 2026-10-28). Absent before the report and when there is no deposit.
   */
  depositNotReceived?: true;
}

/**
 * One thing the deposit settlement CHARGED — a retention for partial damage, or a lost/broken unit
 * billed at its replacement value. Every figure is the API's, copied verbatim (never re-derived).
 */
export type DocumentDepositClaim =
  | { kind: 'retention'; amount: number; reason?: string }
  | {
      kind: 'replacement';
      description: string;
      quantity: number;
      unitAmount: number;
      amount: number;
      note?: string;
    };

/**
 * The damages a recorded report CHARGED, itemised — the "DEPÓSITO Y DAÑOS" section after the
 * summary. Only the charges and their total: what they DO to the money (credited against the
 * deposit, added to what is owed) is the squared result in the totals panel, so the section never
 * states a competing balance of its own (owner, 2026-10-27).
 *
 * The security deposit itself — printed simply as **"Depósito"**, the owner's word with clients
 * (never "garantía" or "liquidación") — is never a cost: it lives in {@link DocumentTotals.balance}
 * as money to hand over, money on hand, or a credit. A deposit NOT received is never credited.
 */
export interface DocumentDamages {
  /** The deposit figures in this section — it was received (held), or a retention was charged
   *  "of the deposit" — so the section is "Depósito y daños" rather than "Daños". */
  withDeposit: boolean;
  /** The deposit was NOT received: a retention is still charged (up to the nominal deposit), and
   *  its row carries a caption saying it is billed apart rather than taken from money we hold. */
  depositNotReceived: boolean;
  claims: DocumentDepositClaim[];
  total: number;
}

export interface DocumentModel {
  kind: DocumentKind;
  letterhead: DocumentLetterhead;
  /** The order's id — a comprobante's identity. Absent on a quote: no order exists yet. */
  reference?: number;
  issuedAt: Date;
  /** Only a quote states one; a comprobante records what was agreed, which does not expire. */
  validUntil?: Date;
  isPaid: boolean;
  client: {
    name: string;
    contact: string;
    address: string;
  };
  event: {
    type: string;
    deliveryAt: Date;
    /** Absent = a purchase-only order: no collection, and no billed days to show. */
    pickupAt?: Date;
    billedDays?: number;
  };
  groups: DocumentGroup[];
  totals: DocumentTotals;
  /** Absent unless a recorded damage report charged something. */
  damages?: DocumentDamages;
  currencySymbol: string;
}

/** A `documents.*` settings array → the typed letterhead. Reads DEFENSIVELY: a key the API has not
 *  published yet resolves to its empty value rather than throwing, so a document can always be
 *  produced — a missing phone line is a far better failure than a button that does nothing. */
export function readLetterhead(
  settings: readonly PreferenceSetting[],
  banks: readonly DocumentBankAccount[],
): DocumentLetterhead {
  const text = (key: string): string => {
    const setting = settings.find((candidate) => candidate.key === key);
    return setting?.type === 'text' ? setting.value : '';
  };
  const int = (key: string, fallback: number): number => {
    const setting = settings.find((candidate) => candidate.key === key);
    return setting?.type === 'int' ? setting.value : fallback;
  };
  return {
    businessName: text('documents.businessName'),
    businessPhone: text('documents.businessPhone'),
    hasTerms: text('documents.terms').trim() !== '',
    conditions: splitConditions(text('documents.conditions')),
    freeDeliveryNote: text('documents.freeDeliveryNote').trim(),
    // Mirrors `appConfig.defaultQuoteValidityDays` (one week). Only reached on a database that has
    // never seen the setting — normally the API sends the admin's own value.
    quoteValidityDays: int('documents.quoteValidityDays', 7),
    banks: [...banks],
  };
}

/** How many printed conditions a document will carry, whatever the admin typed. Past this the block
 *  starts competing with the totals for the reader's attention, which is the exact failure that
 *  keeps the full terms off the page (§5). The API's 400-character cap makes hitting it unlikely;
 *  this is the guarantee rather than the expectation. */
const MAX_CONDITIONS = 4;

/** A `documents.conditions` blob → the lines to print. Blank lines are dropped rather than printed
 *  as empty bullets: a paragraph break in the textarea is formatting, not a condition. */
function splitConditions(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, MAX_CONDITIONS);
}

/**
 * Everything the document states as a condition, in reading order.
 *
 * The free-delivery line comes FIRST because it is the only one derived from THIS order — the rest
 * are standing policy that reads the same on every page. It is also the only good news in the
 * block, and burying a concession under two caveats is a strange way to grant one.
 *
 * Exported and pure because this is the whole rule: a template that decided when to print a free
 * delivery would be a second place for "is it actually free" to be answered.
 */
export function printedConditions(model: DocumentModel): string[] {
  const free =
    model.totals.delivery === 0 && model.letterhead.freeDeliveryNote !== ''
      ? [model.letterhead.freeDeliveryNote]
      : [];
  return [...free, ...model.letterhead.conditions];
}

/** Money rounded the way every other amount in this codebase is — to the cent, never a float tail. */
const cents = (value: number): number => Math.round(value * 100) / 100;

/** A row's photo field — present only when there is a photo (never `imageUrl: undefined`). */
const imageOf = (imageUrl: string | undefined): DocumentLineImage =>
  imageUrl === undefined ? {} : { imageUrl };

/**
 * Does the DÍAS column actually explain this line's total?
 *
 * Not every rental is billed per day. `rent_time_units` seeds Hora, Día, Semana, Mes and **Evento**
 * — a flat per-event rate, duration-agnostic — and only a "Día" product multiplies by the window.
 * Printing `Días 3` beside `Precio por día` on an Evento line states arithmetic that does not
 * reconcile: the reader multiplies three numbers, gets something else than the subtotal beside them,
 * and stops trusting the rest of the page.
 *
 * The test is the arithmetic ITSELF rather than the product's time unit, because the comprobante
 * never sees a time unit — `OrderLine` carries prices, not pricing rules. That makes this the one
 * rule both adapters can apply, so the same order cannot describe itself differently as a quote and
 * as a receipt. It also does the right thing for a line whose total was adjusted server-side: we
 * simply stop claiming a breakdown we cannot justify.
 */
const daysExplain = (unitPrice: number, quantity: number, days: number, total: number): boolean =>
  Math.abs(unitPrice * quantity * days - total) < 0.005;

/**
 * A saved order → the input of THE balancing rule (`squareOrderBalance`). One builder, used by the
 * comprobante and the damage report alike, so the two documents square the same order the same way.
 *
 * - `advance` is the ANTICIPO (`depositAmount` — the field's name predates the security deposit);
 * - `deposit` exists only when the order carries one (`total > 0`), with its collection status — a
 *   legacy order without a collection reads PENDING. Only a RECEIVED one is ever on hand or credited
 *   (owner, 2026-10-28); the rule decides what a pending or not-received one means;
 * - `claimsTotal` is the damage report's — the caller's, because the damage report may be built from
 *   the report form's values rather than the saved settlement.
 *
 * The order page's cuadre (`OrderBalanceSummary`) builds its input HERE too, so the screen and every
 * document feed the rule the same figures.
 */
export function orderBalanceInput(
  order: OrderDetail,
  claimsTotal: number | undefined,
): OrderBalanceInput {
  const deposit = order.securityDeposit;
  return {
    total: order.totalAmount,
    advance: order.depositAmount ?? 0,
    paid: order.paidAt !== undefined,
    ...(deposit !== undefined &&
      deposit.total > 0 && {
        deposit: { amount: deposit.total, status: deposit.collection?.status ?? 'PENDING' },
      }),
    ...(claimsTotal !== undefined && { claimsTotal }),
  };
}

/**
 * The order carries a deposit that was NOT received — pending, or recorded as not received (a
 * legacy order without a collection reads pending). Only a RECEIVED deposit is money we have
 * (owner, 2026-10-28), so after the damage report such a deposit is never credited and the damages
 * are billed whole.
 */
export function isDepositNotReceived(order: Pick<OrderDetail, 'securityDeposit'>): boolean {
  const deposit = order.securityDeposit;
  return deposit !== undefined && deposit.total > 0 && deposit.collection?.status !== 'RECEIVED';
}

/**
 * The name a replacement prints: the damaged line's product + variation (`lineDisplayName`). The
 * damage's OWN `variantLabel` wins (the API snapshots it with the settlement); a damage without one
 * borrows its line's, so a report never names "Mantel" where the comprobante said "Mantel — Rojo".
 */
export function damageDisplayName(damage: OrderDamage, lines: readonly OrderLine[]): string {
  return lineDisplayName({
    productName: damage.productName,
    variantLabel:
      damage.variantLabel ?? lines.find((line) => line.id === damage.lineId)?.variantLabel,
  });
}

/**
 * A recorded settlement → the charges it made, itemised (a retention, then each replacement), every
 * figure the API's own. Empty when the report was clean.
 */
function claimsOf(settlement: OrderDepositSettlement, lines: readonly OrderLine[]): DocumentDepositClaim[] {
  return [
    ...(settlement.retainedAmount > 0
      ? [
          {
            kind: 'retention' as const,
            amount: settlement.retainedAmount,
            ...(settlement.retainedReason !== undefined && { reason: settlement.retainedReason }),
          },
        ]
      : []),
    ...settlement.damages.map<DocumentDepositClaim>((damage) => ({
      kind: 'replacement',
      description: damageDisplayName(damage, lines),
      quantity: damage.quantity,
      unitAmount: damage.unitAmount,
      amount: damage.amount,
      ...(damage.note !== undefined && { note: damage.note }),
    })),
  ];
}

/** The itemised damages section, or nothing when there is no report or it charged nothing. `held`
 *  is the deposit in hand — 0 unless RECEIVED; a retention still names the deposit it is "part of",
 *  received or not. */
function damagesOf(order: OrderDetail): DocumentDamages | undefined {
  const deposit = order.securityDeposit;
  const settlement = deposit?.settlement;
  if (deposit === undefined || settlement === undefined) return undefined;
  const claims = claimsOf(settlement, order.lines);
  if (claims.length === 0) return undefined;
  return {
    withDeposit: deposit.held > 0 || settlement.retainedAmount > 0,
    depositNotReceived: isDepositNotReceived(order),
    claims,
    total: settlement.claimsTotal,
  };
}

/**
 * The squared result's companion rows for a PAID order: what the payment settled after the
 * anticipo. Read through the same rule as an UNPAID order's `serviceDue`, so "what was left to pay"
 * and "what the payment covered" can never be two different sums.
 */
function paidRemainder(input: OrderBalanceInput): number {
  return input.paid ? squareOrderBalance({ ...input, paid: false }).serviceDue : 0;
}

/**
 * The `Anticipo` row (and its caption) so the column ADDS UP. An anticipo larger than the TOTAL
 * prints only the part that went to the service; the rest is the squared box's own `Saldo a favor
 * del cliente` row (`advanceCredit`, net of a deposit in hand that the excess already is), and the
 * caption keeps the amount actually received on paper. Paid or not, the same. Exported for
 * `scripts/preview-document.tsx`, so the preview's hand-built model cannot drift from this rule.
 */
export function advanceRows(
  advance: number | undefined,
  total: number,
): Pick<DocumentTotals, 'advance' | 'advanceReceived'> {
  if (advance === undefined || advance <= 0) return {};
  return advance > total ? { advance: total, advanceReceived: advance } : { advance };
}

/**
 * A SAVED order → its comprobante. Every figure is the order's own stored price; nothing here
 * re-derives money, because the server already priced it and a document that recomputed could
 * disagree with the record it claims to be.
 *
 * `billedDays` is the one derived value, and it is DISPLAYED rather than applied: without it a
 * one-day and a three-day rental print identically at different totals, which reads as an error.
 * It mirrors the backend's own rule through the shared `computeBilledDays`.
 */
export function fromOrderDetail(
  order: OrderDetail,
  letterhead: DocumentLetterhead,
  issuedAt: Date,
): DocumentModel {
  const deliveryAt = new Date(order.serviceStart);
  const pickupAt = order.pickupAt === undefined ? undefined : new Date(order.serviceEnd);
  const billedDays =
    pickupAt === undefined ? undefined : computeBilledDays(deliveryAt, pickupAt);

  const groups: DocumentGroup[] = (['rental', 'sale'] as const)
    .map((kind) => {
      const lines = order.lines
        .filter((line) => (kind === 'rental') === line.isRental)
        .map<DocumentLine>((line) => ({
          // "Mantel — Rojo · Redondo": the line's own variation snapshot, never re-looked-up.
          description: lineDisplayName(line),
          // The API's per-line photo — already variation-aware (the value's photo, else the
          // showcase primary); no client rule second-guesses it.
          ...imageOf(line.imageUrl),
          quantity: line.quantity,
          unitPrice: line.unitaryPrice,
          // Days belong to the RENTAL table only: they are what makes `precio × cant. × días =
          // total` check out by hand. On a sale they would be a column of 1s explaining nothing —
          // and on a rental they appear only where they genuinely explain the total (`daysExplain`).
          ...(kind === 'rental' &&
            billedDays !== undefined &&
            daysExplain(line.unitaryPrice, line.quantity, billedDays, line.parcialPrice) && {
              days: billedDays,
            }),
          total: line.parcialPrice,
        }));
      return {
        kind,
        lines,
        subtotal: cents(lines.reduce((sum, line) => sum + line.total, 0)),
      };
    })
    // A group nobody ordered from does not exist — never an empty table with a heading.
    .filter((group) => group.lines.length > 0);

  const advance = order.depositAmount;
  const settlement = order.securityDeposit?.settlement;
  const input = orderBalanceInput(order, settlement?.claimsTotal);
  const paid = paidRemainder(input);
  const damages = damagesOf(order);

  return {
    kind: 'receipt',
    letterhead,
    reference: order.id,
    issuedAt,
    isPaid: order.isPaid,
    client: {
      name: order.clientName,
      contact: order.deliveryContact,
      address: order.deliveryAddress,
    },
    event: {
      type: order.eventType.name,
      deliveryAt,
      ...(pickupAt !== undefined && { pickupAt }),
      ...(billedDays !== undefined && { billedDays }),
    },
    groups,
    totals: {
      groups: groups.map((group) => ({ kind: group.kind, subtotal: group.subtotal })),
      ...(order.deliveryAmount !== undefined && { delivery: order.deliveryAmount }),
      ...(order.discountAmount !== undefined && { discount: order.discountAmount }),
      total: order.totalAmount,
      ...advanceRows(advance, order.totalAmount),
      ...(paid > 0 && { paid }),
      balance: squareOrderBalance(input),
      ...(settlement !== undefined &&
        isDepositNotReceived(order) && { depositNotReceived: true as const }),
    },
    ...(damages !== undefined && { damages }),
    currencySymbol: order.currency.symbol,
  };
}

/**
 * Everything the quote adapter needs that is not already in the form's own values: the products the
 * lines point at, and the two names the form holds as ids rather than text.
 *
 * The caller resolves them because it already has the catalogs loaded; asking this module to look
 * them up would drag the whole reference-data layer into a pure function.
 */
export interface QuoteSource {
  values: CreateOrderFormType;
  productsById: ReadonlyMap<number, Product>;
  /** The registry client when one is picked, else the delivery contact's name — a quote is always
   *  addressed to somebody, and the form guarantees at least the latter. */
  clientName: string;
  eventTypeName: string;
}

/**
 * An UNSAVED order form → its cotización.
 *
 * The mirror of {@link fromOrderDetail}, and the reason the two exist at all: quoting on the phone
 * before the client commits is the whole point, so this reads the form's own ESTIMATE
 * (`orderEstimate.ts`, itself a mirror of the backend's pricing) rather than any saved figure. The
 * arithmetic is therefore identical to the total the admin is looking at while they talk.
 *
 * Returns `undefined` when the values cannot make a document — an unparseable delivery date, or not
 * one line pointing at a product we hold. The caller runs the form's own resolver first, so this is
 * defence in depth rather than the expected path; it is `undefined` and not a throw because failing
 * to produce a PDF is a "nothing happened, tell them" moment, never a crashed screen.
 *
 * **No `reference`, and a `validUntil`.** A quote has no order to name, and unlike a comprobante —
 * which records what was agreed and does not expire — it is a proposal with a shelf life. `kind`
 * carries the rest: the title, and the "sujeta a cambios" notice the template prints for a quote.
 */
export function fromOrderForm(
  source: QuoteSource,
  letterhead: DocumentLetterhead,
  issuedAt: Date,
): DocumentModel | undefined {
  const { values, productsById } = source;
  const deliveryAt = parseDateTime(values.deliveryAt);
  if (deliveryAt === null) return undefined;

  const priced = values.lines.flatMap((line) => {
    const product = productsById.get(line.productId);
    const quantity = parseLineQuantity(line.quantity);
    // A line the picker has not finished, or a product the cache no longer holds, contributes
    // nothing — exactly as it contributes nothing to the estimate the admin is reading.
    return product === undefined || quantity === null
      ? []
      : [
          {
            product,
            // The variation the line picked (absent for a product without them, or an unfinished
            // pick — which the resolver refuses before a quote is ever built).
            variant: variantFor(product, line.variantId),
            quantity,
            isRental: isRentalProduct(product),
          },
        ];
  });
  // Destructured rather than length-checked so the currency below reads off a NARROWED value: with
  // `noUncheckedIndexedAccess` an index would need a `?? ''` fallback that can never be reached.
  const [firstPriced] = priced;
  if (firstPriced === undefined) return undefined;

  // Pickup only exists when something is actually rented — the form hides the field otherwise, so a
  // leftover value there is stale. Same rule as the schema's own pickup coherence check.
  const anyRental = priced.some((line) => line.isRental);
  const pickupAt = anyRental ? parseDateTime(values.pickupAt) : null;
  const billedDays = pickupAt === null ? undefined : computeBilledDays(deliveryAt, pickupAt);

  const groups: DocumentGroup[] = (['rental', 'sale'] as const)
    .map((kind) => {
      const lines = priced
        .filter((line) => (kind === 'rental') === line.isRental)
        .map<DocumentLine>((line) => {
          // The variation's EFFECTIVE price when one is picked — the same figure the form's estimate
          // shows beside the line.
          const unitPrice = lineUnitPrice(line.product, line.variant);
          const total = estimateLineSubtotal(line.product, line.quantity, billedDays ?? 1, line.variant);
          return {
            description: lineDisplayName({
              productName: line.product.name,
              variantLabel: line.variant?.label,
            }),
            // The variation's own photo, else the SHOWCASE primary (flagged, else first) — never
            // `coverImageUrl`, which falls back to the DEFAULT variation and could print the wrong
            // colour. The API's comprobante rule, read off the catalog the form already holds.
            ...imageOf(line.variant?.imageUrl ?? primaryImageUrl(line.product) ?? undefined),
            quantity: line.quantity,
            unitPrice,
            ...(kind === 'rental' &&
              billedDays !== undefined &&
              daysExplain(unitPrice, line.quantity, billedDays, total) && { days: billedDays }),
            total,
          };
        });
      return { kind, lines, subtotal: cents(lines.reduce((sum, line) => sum + line.total, 0)) };
    })
    .filter((group) => group.lines.length > 0);

  // `parseMoney` reads a blank field as `undefined` — which is a real answer, not zero: a fee left
  // empty is a fee the admin has not quoted, and the document stays silent about delivery rather
  // than promising "Gratis". An explicit `0` DOES print as Gratis. (`null` is unparseable, which the
  // resolver already rejected; treated as absent here for the same reason.)
  const delivery = parseMoney(values.deliveryAmount) ?? undefined;
  // The ANTICIPO (the form's `depositAmount`), not the security deposit below.
  const advance = parseMoney(values.depositAmount) ?? undefined;
  const linesTotal = groups.reduce((sum, group) => sum + group.subtotal, 0);
  const total = cents(linesTotal + (delivery ?? 0));
  // The security deposit the order WOULD carry — the server's own rule (Σ rental line's per-unit
  // deposit × quantity), estimated from the catalog exactly as the prices are. Kept OUT of `total`:
  // it is collected on top and refunded at pickup, and a quote that folded it in would overstate
  // the price of the event.
  const securityDeposit = cents(
    priced
      .filter((line) => line.isRental)
      .reduce(
        (sum, line) =>
          sum + (effectivePricing(line.product, line.variant).securityDeposit ?? 0) * line.quantity,
        0,
      ),
  );

  return {
    kind: 'quote',
    letterhead,
    issuedAt,
    validUntil: new Date(issuedAt.getTime() + letterhead.quoteValidityDays * DAY_MS),
    isPaid: false,
    client: {
      name: source.clientName,
      contact: values.deliveryContact,
      address: values.deliveryAddress,
    },
    event: {
      type: source.eventTypeName,
      deliveryAt,
      ...(pickupAt !== null && { pickupAt }),
      ...(billedDays !== undefined && { billedDays }),
    },
    groups,
    totals: {
      groups: groups.map((group) => ({ kind: group.kind, subtotal: group.subtotal })),
      ...(delivery !== undefined && { delivery }),
      total,
      ...advanceRows(advance, total),
      // Squared by the same rule as a saved order. A quote's deposit is always still to be handed
      // over (PENDING) and nothing can have been claimed — nothing has been delivered yet.
      balance: squareOrderBalance({
        total,
        advance: advance ?? 0,
        paid: false,
        ...(securityDeposit > 0 && {
          deposit: { amount: securityDeposit, status: 'PENDING' as const },
        }),
      }),
    },
    currencySymbol: firstPriced.product.currency.symbol,
  };
}

// ── The damage report ("REPORTE DE DAÑOS") ───────────────────────────────────────────────────────

/** One rental line that carried a deposit: what the client handed over for it. */
export interface DamageReportDepositLine extends DocumentLineImage {
  description: string;
  quantity: number;
  /** The per-unit deposit the line snapshotted at order time. */
  unitAmount: number;
  total: number;
}

/** One lost/broken entry, billed at the line's replacement value — the API's figures, verbatim. */
export interface DamageReportReplacement extends DocumentLineImage {
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  note?: string;
}

/**
 * The damage report — a client-facing statement of what the pickup review found and what it costs
 * (EPIC-2-DOCUMENTS §2c). Its own model rather than a third `kind` of {@link DocumentModel}: it has
 * no lines to sell, no order totals and no saldo of the order, so squeezing it into that shape would
 * leave half the fields meaningless. It shares everything that is NOT order-specific — the
 * letterhead, the client and event snapshots, the reference format and the money rules — and the
 * template shares the frame, the tables and the bank block, so the two documents cannot drift into
 * looking like different companies.
 */
export interface DamageReportModel {
  letterhead: DocumentLetterhead;
  /** The order's id — the report is always ABOUT a saved order. */
  reference: number;
  /** The download moment — the report's only date. */
  issuedAt: Date;
  client: DocumentModel['client'];
  event: { type: string; deliveryAt: Date; pickupAt?: Date };
  deposit: {
    /** The deposit RECEIVED (`OrderSecurityDeposit.held` of a RECEIVED collection): 0 when the
     *  lines carried none, and 0 when it was not received — the "Depósito recibido" section is then
     *  absent (owner, 2026-10-28). */
    total: number;
    /** Each rental line that carried a deposit — the breakdown of `total`; empty when it is 0. */
    lines: DamageReportDepositLine[];
  };
  /** The order carries a deposit that was NOT received: nothing is credited, the damages are
   *  billed whole — said under the result, and as a caption on the retention. */
  depositNotReceived: boolean;
  /** Present only when money was retained from the deposit for partial damage. */
  retention?: { amount: number; reason?: string };
  replacements: DamageReportReplacement[];
  totals: {
    retained: number;
    damages: number;
    claims: number;
  };
  /** The order SQUARED with this report's claims — the same rule and the same result as the
   *  comprobante's, so the two documents can never end on different amounts. */
  balance: OrderBalance;
  currencySymbol: string;
}

/**
 * A saved order + the settlement the admin entered → the damage report.
 *
 * It is THE damage report whether the settlement comes from the saved record or from the report
 * form's values before saving (owner, 2026-10-27: it is generated from what the admin entered, not
 * a sketch) — so it carries no draft mark and no second date: it is issued at the download.
 *
 * Every figure in `totals`, every replacement and the deposit total are the settlement's / the API's
 * own, copied verbatim; the outcome is `squareOrderBalance` over the order with these claims. The
 * one product here is the per-line deposit BREAKDOWN (`unitAmount × quantity`), which is the server's
 * own rule for that total, the same way the comprobante's lines show `price × qty`.
 */
export function fromDamageReport(
  order: OrderDetail,
  settlement: OrderDepositSettlement,
  letterhead: DocumentLetterhead,
  issuedAt: Date,
): DamageReportModel {
  const deliveryAt = new Date(order.serviceStart);
  const pickupAt = order.pickupAt === undefined ? undefined : new Date(order.serviceEnd);
  // Only a deposit actually RECEIVED is printed as received (owner, 2026-10-28) — the API's `held`
  // agrees (0 otherwise); the status is read as well so the section can never claim a receipt the
  // collection does not record.
  const deposit = order.securityDeposit;
  const held = deposit?.collection?.status === 'RECEIVED' ? deposit.held : 0;
  const depositLines = order.lines.flatMap<DamageReportDepositLine>((line) => {
    const unitAmount = line.securityDeposit ?? 0;
    return held > 0 && line.isRental && unitAmount > 0
      ? [
          {
            description: lineDisplayName(line),
            ...imageOf(line.imageUrl),
            quantity: line.quantity,
            unitAmount,
            total: cents(unitAmount * line.quantity),
          },
        ]
      : [];
  });
  return {
    letterhead,
    reference: order.id,
    issuedAt,
    client: {
      name: order.clientName,
      contact: order.deliveryContact,
      address: order.deliveryAddress,
    },
    event: {
      type: order.eventType.name,
      deliveryAt,
      ...(pickupAt !== undefined && { pickupAt }),
    },
    deposit: { total: held, lines: depositLines },
    depositNotReceived: isDepositNotReceived(order),
    ...(settlement.retainedAmount > 0 && {
      retention: {
        amount: settlement.retainedAmount,
        ...(settlement.retainedReason !== undefined && { reason: settlement.retainedReason }),
      },
    }),
    replacements: settlement.damages.map((damage) => ({
      description: damageDisplayName(damage, order.lines),
      // The damaged LINE's photo — the same one its row carries on the comprobante.
      ...imageOf(order.lines.find((line) => line.id === damage.lineId)?.imageUrl),
      quantity: damage.quantity,
      unitAmount: damage.unitAmount,
      amount: damage.amount,
      ...(damage.note !== undefined && { note: damage.note }),
    })),
    totals: {
      retained: settlement.retainedAmount,
      damages: settlement.damagesTotal,
      claims: settlement.claimsTotal,
    },
    balance: squareOrderBalance(orderBalanceInput(order, settlement.claimsTotal)),
    currencySymbol: order.currency.symbol,
  };
}

/** `PED-00042` — an order's reference, zero-padded so a stack of documents sorts and scans. */
export const formatReference = (id: number): string => `PED-${String(id).padStart(5, '0')}`;

/** A comprobante's reference. Absent on a quote: no order exists yet. */
export function documentReference(model: Pick<DocumentModel, 'reference'>): string | undefined {
  return model.reference === undefined ? undefined : formatReference(model.reference);
}

/** The damage report's file name — the comprobante's convention (`ped-00042.pdf`) with what the
 *  document IS in front: `reporte-danos-ped-00042.pdf`. */
export function damageReportFileName(model: Pick<DamageReportModel, 'reference'>): string {
  return `reporte-danos-${formatReference(model.reference).toLowerCase()}.pdf`;
}

/**
 * The downloaded file's name. Ours to choose — which is half the reason this is a real PDF rather
 * than a print stylesheet, where the browser names the file after the page title.
 *
 * A comprobante borrows the order's identity. A quote has none, so it is named for the DAY it was
 * issued, written `dd-mm-yyyy` — the order this file's readers read dates in. It was `yyyy-mm-dd`
 * until 2026-08-26: that sorts beautifully in a file manager and is not how anyone here writes a
 * date, and this name is read by the client who receives the attachment, not only by the admin.
 *
 * The parts are LOCAL, never `toISOString()`. That serialises to UTC, so in Guatemala (UTC−6) every
 * quote produced after 6pm would be named for the following day — a document dated one day and
 * filed under another, which is exactly the sort of discrepancy that makes a client query it.
 */
export function documentFileName(model: DocumentModel): string {
  const reference = documentReference(model);
  if (reference !== undefined) return `${reference.toLowerCase()}.pdf`;
  const issued = model.issuedAt;
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${pad(issued.getDate())}-${pad(issued.getMonth() + 1)}-${issued.getFullYear()}`;
  return `cotizacion-${stamp}.pdf`;
}
