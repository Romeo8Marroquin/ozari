import {
  computeBilledDays,
  estimateLineSubtotal,
  isRentalProduct,
  lineUnitPrice,
} from '../orders/orderEstimate';
import { parseDateTime, parseLineQuantity, parseMoney } from '../orders/SchemaCreateOrder';
import type { CreateOrderFormType } from '../orders/SchemaCreateOrder';
import type { OrderDetail } from '../orders/order.types';
import type { Product } from '../products/product.types';
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

/** One priced row of a group. `days` is present only where it changes the arithmetic (rentals). */
export interface DocumentLine {
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
  total: number;
  deposit?: number;
  /**
   * What the client still owes. **Zero when the order is paid** — that is the whole point of being
   * able to hand this document over at any step: it goes out as a request for payment, and comes
   * back as proof of one. The TOTAL is never zeroed: a receipt claiming a total of Q0.00 would be
   * evidence that nothing was ever charged, which is the opposite of what a paid order should show.
   */
  balance: number;
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
          description: line.productName,
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

  const deposit = order.depositAmount;
  // Clamped at zero, like the dashboard's outstanding figure: a deposit larger than the total is a
  // slip, and printing a NEGATIVE balance would read as the business owing the client money.
  const balance = order.isPaid ? 0 : Math.max(0, cents(order.totalAmount - (deposit ?? 0)));

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
      ...(deposit !== undefined && { deposit }),
      balance,
    },
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
      : [{ product, quantity, isRental: isRentalProduct(product) }];
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
          const unitPrice = lineUnitPrice(line.product);
          const total = estimateLineSubtotal(line.product, line.quantity, billedDays ?? 1);
          return {
            description: line.product.name,
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
  const deposit = parseMoney(values.depositAmount) ?? undefined;
  const linesTotal = groups.reduce((sum, group) => sum + group.subtotal, 0);
  const total = cents(linesTotal + (delivery ?? 0));

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
      ...(deposit !== undefined && { deposit }),
      // Clamped like the comprobante's: a deposit above the total is a slip, and a negative balance
      // would read as the business owing the client money before anything has been agreed.
      balance: Math.max(0, cents(total - (deposit ?? 0))),
    },
    currencySymbol: firstPriced.product.currency.symbol,
  };
}

/** `PED-00042` — a comprobante's reference, zero-padded so a stack of them sorts and scans. */
export function documentReference(model: DocumentModel): string | undefined {
  return model.reference === undefined
    ? undefined
    : `PED-${String(model.reference).padStart(5, '0')}`;
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
