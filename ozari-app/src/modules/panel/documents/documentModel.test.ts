import { describe, expect, it } from 'vitest';
import {
  documentFileName,
  documentReference,
  fromOrderDetail,
  fromOrderForm,
  printedConditions,
  readLetterhead,
  type DocumentLetterhead,
} from './documentModel';
import { createOrderDefaultValues } from '../orders/SchemaCreateOrder';
import type { CreateOrderFormType } from '../orders/SchemaCreateOrder';
import type { OrderDetail } from '../orders/order.types';
import type { Product } from '../products/product.types';
import type { PreferenceSetting } from '../preferences/preference.types';

// Built from LOCAL parts, not an ISO string: the quote's file name is stamped with local date parts
// (see `documentFileName`), so a UTC fixture would name the file differently depending on the
// machine's timezone and this suite would pass in Guatemala and fail in Sydney.
const ISSUED_AT = new Date(2026, 7, 5, 15, 0);

const letterhead: DocumentLetterhead = {
  businessName: 'Party Rentals GT',
  businessPhone: '1234-5678',
  hasTerms: true,
  conditions: ['Cualquier daño ocasionado en el mobiliario se cobrará.'],
  freeDeliveryNote: 'Domicilio gratis en Hacienda Real.',
  quoteValidityDays: 15,
  banks: [],
};

const line = (over: Partial<OrderDetail['lines'][number]> = {}) => ({
  id: 1,
  productId: 1,
  productName: 'Mesa redonda',
  isRental: true,
  quantity: 5,
  unitaryPrice: 10,
  parcialPrice: 150,
  ...over,
});

const order = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: 42,
    clientName: 'Test cliente',
    eventType: { id: 1, name: 'Evento familiar' },
    currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
    isPaid: false,
    totalAmount: 150,
    deliveryContact: '1234-1234',
    deliveryAddress: 'Test dirección',
    // Delivery Wed → pickup Fri = 2 started days.
    serviceStart: '2026-07-29T17:50:00Z',
    serviceEnd: '2026-07-31T22:50:00Z',
    pickupAt: '2026-07-31T22:50:00Z',
    lines: [line()],
    ...over,
  }) as unknown as OrderDetail;

describe('readLetterhead', () => {
  const settings: PreferenceSetting[] = [
    {
      key: 'documents.businessName',
      type: 'text',
      value: 'Alquileres El Sol',
      minLength: 2,
      maxLength: 120,
      multiline: false,
      group: 'documents',
    },
    {
      key: 'documents.terms',
      type: 'text',
      value: '  ',
      minLength: 0,
      maxLength: 1200,
      multiline: true,
      group: 'documents',
    },
    {
      key: 'documents.quoteValidityDays',
      type: 'int',
      value: 30,
      min: 1,
      max: 365,
      group: 'documents',
    },
  ];

  it('reads each key from the arm of the union it belongs to', () => {
    expect(readLetterhead(settings, [])).toMatchObject({
      businessName: 'Alquileres El Sol',
      quoteValidityDays: 30,
    });
  });

  it('treats WHITESPACE-only terms as no terms', () => {
    // The acceptance line points at conditions; pointing at a blank field would be worse than
    // saying nothing, and a stray space is not a term.
    expect(readLetterhead(settings, []).hasTerms).toBe(false);
  });

  it('survives a key the API has not published, rather than refusing to build a document', () => {
    // A missing phone line is a far better failure than a button that does nothing.
    const bare = readLetterhead([], []);
    expect(bare).toMatchObject({ businessName: '', businessPhone: '', hasTerms: false });
    // The validity still has a usable default — a quote has to state SOME period.
    expect(bare.quoteValidityDays).toBeGreaterThan(0);
  });

  it('splits the printed conditions one per line, dropping blanks and capping the block', () => {
    // A paragraph break in the textarea is formatting, not a condition — an empty bullet on a page
    // handed to a client reads as a missing sentence. The cap is what keeps the block from
    // competing with the totals, which is the whole reason the full terms stay off the page.
    const withConditions: PreferenceSetting[] = [
      {
        key: 'documents.conditions',
        type: 'text',
        value: ' Uno \n\n  Dos\nTres\nCuatro\nCinco\nSeis ',
        minLength: 0,
        maxLength: 400,
        multiline: true,
        group: 'documents',
      },
    ];
    expect(readLetterhead(withConditions, []).conditions).toEqual([
      'Uno',
      'Dos',
      'Tres',
      'Cuatro',
    ]);
  });

  it('ignores a setting whose type does not match the field', () => {
    // Defensive against a stale client meeting a re-typed setting: the wrong arm reads as absent
    // rather than putting an integer where a business name goes.
    const swapped: PreferenceSetting[] = [
      { key: 'documents.businessName', type: 'int', value: 5, min: 1, max: 9, group: 'documents' },
    ];
    expect(readLetterhead(swapped, []).businessName).toBe('');
  });
});

describe('fromOrderDetail', () => {
  it('splits the lines into rental and sale groups, each with its own subtotal', () => {
    const model = fromOrderDetail(
      order({
        lines: [line(), line({ id: 2, productName: 'Piñata', isRental: false, quantity: 1, unitaryPrice: 40, parcialPrice: 40 })],
        totalAmount: 190,
      }),
      letterhead,
      ISSUED_AT,
    );
    expect(model.groups.map((group) => group.kind)).toEqual(['rental', 'sale']);
    expect(model.groups[0]?.subtotal).toBe(150);
    expect(model.groups[1]?.subtotal).toBe(40);
  });

  it('OMITS a group nobody ordered from — never an empty table under a heading', () => {
    const model = fromOrderDetail(order(), letterhead, ISSUED_AT);
    expect(model.groups.map((group) => group.kind)).toEqual(['rental']);
  });

  it('shows the billed DAYS on rental lines, so the arithmetic checks out by hand', () => {
    // Without it a one-day and a three-day rental print identically at different totals, which
    // reads as an error. Two started days here (Wed 17:50 → Fri 22:50).
    const model = fromOrderDetail(order(), letterhead, ISSUED_AT);
    expect(model.event.billedDays).toBe(3);
    expect(model.groups[0]?.lines[0]?.days).toBe(3);
  });

  it('a PURCHASE-ONLY order has no pickup, no days, and no days column', () => {
    const purchase = order({
      lines: [line({ isRental: false })],
      totalAmount: 150,
    });
    delete (purchase as { pickupAt?: string }).pickupAt;
    const model = fromOrderDetail(purchase, letterhead, ISSUED_AT);
    expect(model.event.pickupAt).toBeUndefined();
    expect(model.event.billedDays).toBeUndefined();
    expect(model.groups[0]?.lines[0]?.days).toBeUndefined();
  });

  it('carries the delivery fee and the discount only when the order has them', () => {
    const bare = fromOrderDetail(order(), letterhead, ISSUED_AT);
    expect(bare.totals.delivery).toBeUndefined();
    expect(bare.totals.discount).toBeUndefined();

    const charged = fromOrderDetail(
      order({ deliveryAmount: 0, discountAmount: 25 }),
      letterhead,
      ISSUED_AT,
    );
    // ZERO must survive as zero: "Gratis" is something the business is telling the client, and it
    // is a different answer from "no hay envío".
    expect(charged.totals.delivery).toBe(0);
    expect(charged.totals.discount).toBe(25);
  });

  it('subtracts the deposit from the balance but never from the TOTAL', () => {
    const model = fromOrderDetail(order({ depositAmount: 50 }), letterhead, ISSUED_AT);
    expect(model.totals.total).toBe(150);
    expect(model.totals.balance).toBe(100);
  });

  it('a PAID order owes zero and says so, while still showing what was charged', () => {
    // The same page goes out as a request for payment and comes back as proof of one. Zeroing the
    // TOTAL instead would be evidence that nothing was ever charged.
    const model = fromOrderDetail(order({ isPaid: true, depositAmount: 20 }), letterhead, ISSUED_AT);
    expect(model.isPaid).toBe(true);
    expect(model.totals.balance).toBe(0);
    expect(model.totals.total).toBe(150);
  });

  it('CLAMPS a balance that would go negative', () => {
    // A deposit larger than the total is a slip; printing a negative balance would read as the
    // business owing the client money. Same stance as the dashboard's outstanding figure.
    const model = fromOrderDetail(order({ depositAmount: 500 }), letterhead, ISSUED_AT);
    expect(model.totals.balance).toBe(0);
  });

  it('takes every figure from the order, never re-deriving one', () => {
    // The server priced this; a document that recomputed could disagree with the record it claims
    // to be. The line total stands even when it does not equal quantity × unit price.
    const model = fromOrderDetail(
      order({ lines: [line({ parcialPrice: 137.5 })], totalAmount: 137.5 }),
      letterhead,
      ISSUED_AT,
    );
    expect(model.groups[0]?.lines[0]?.total).toBe(137.5);
    expect(model.totals.total).toBe(137.5);
  });

  it('carries the order identity, the client snapshot and the currency', () => {
    const model = fromOrderDetail(order(), letterhead, ISSUED_AT);
    expect(model.kind).toBe('receipt');
    expect(model.reference).toBe(42);
    expect(model.client).toEqual({
      name: 'Test cliente',
      contact: '1234-1234',
      address: 'Test dirección',
    });
    // The symbol travels with the order, never hardcoded — the repo-wide currency rule.
    expect(model.currencySymbol).toBe('Q');
    // A comprobante records what was agreed, which does not expire.
    expect(model.validUntil).toBeUndefined();
  });
});

describe('the DÍAS column', () => {
  // `rent_time_units` seeds Hora, Día, Semana, Mes and Evento. Only a "Día" product multiplies by
  // the window, and the document has no way to see a product's time unit — so it checks the
  // arithmetic instead, which is the one rule BOTH adapters can apply.
  const withTotals = (unitaryPrice: number, quantity: number, parcialPrice: number) =>
    fromOrderDetail(
      order({ lines: [line({ unitaryPrice, quantity, parcialPrice })], totalAmount: parcialPrice }),
      letterhead,
      ISSUED_AT,
    ).groups[0]?.lines[0];

  it('appears when the days genuinely explain the total', () => {
    // 3 billed days × 5 × Q10 = Q150.
    expect(withTotals(10, 5, 150)?.days).toBe(3);
  });

  it('is OMITTED on a flat per-event rental, whose total ignores the window', () => {
    // An "Evento" product bills once whatever the duration: 5 × Q10 = Q50, not Q150. Printing
    // "Días 3" beside "Precio por día" would state arithmetic the reader can check and disprove,
    // which costs the credibility of every other figure on the page.
    expect(withTotals(10, 5, 50)?.days).toBeUndefined();
  });

  it('is omitted when a line total was adjusted and no longer reconciles', () => {
    // We stop claiming a breakdown we cannot justify, rather than printing a wrong one.
    expect(withTotals(10, 5, 137.5)?.days).toBeUndefined();
  });
});

describe('printedConditions', () => {
  const withDelivery = (deliveryAmount?: number, head = letterhead) =>
    printedConditions(
      fromOrderDetail(
        deliveryAmount === undefined ? order() : order({ deliveryAmount }),
        head,
        ISSUED_AT,
      ),
    );

  it('states the free delivery ONLY when the fee is actually zero', () => {
    // The order stores no zone, so the CONDITION has to be derived from the one delivery fact the
    // document holds. Typing the promise into `conditions` instead would print it on billed orders
    // too, which is exactly what this exists to prevent.
    expect(withDelivery(0)[0]).toBe('Domicilio gratis en Hacienda Real.');
    expect(withDelivery(75)).not.toContain('Domicilio gratis en Hacienda Real.');
    // No delivery line at all is not free delivery either — there is nothing to make a claim about.
    expect(withDelivery()).not.toContain('Domicilio gratis en Hacienda Real.');
  });

  it('puts the free-delivery line FIRST, ahead of the standing policy', () => {
    // It is the only condition derived from THIS order, and the only concession in the block.
    expect(withDelivery(0)).toEqual([
      'Domicilio gratis en Hacienda Real.',
      'Cualquier daño ocasionado en el mobiliario se cobrará.',
    ]);
  });

  it('says nothing at all when the business has written nothing', () => {
    // A business that states no conditions and charges for every delivery is a real business; the
    // document omits the block rather than inventing a policy to fill it.
    const silent = { ...letterhead, conditions: [], freeDeliveryNote: '' };
    expect(withDelivery(0, silent)).toEqual([]);
  });
});

describe('fromOrderForm', () => {
  const product = (over: Partial<Product> = {}): Product =>
    ({
      id: 1,
      name: 'Mesa redonda',
      businessTypeId: 1, // Alquiler
      rentTimeUnitId: 2, // Día
      rentPrice: 10,
      currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
      ...over,
    }) as unknown as Product;

  const values = (over: Partial<CreateOrderFormType> = {}): CreateOrderFormType =>
    ({
      ...createOrderDefaultValues,
      eventTypeId: 1,
      clientRegistryId: 7,
      deliveryAt: '2026-07-29T11:50',
      pickupAt: '2026-07-31T16:50',
      deliveryName: 'Quien recibe',
      deliveryContact: '1234-1234',
      deliveryAddress: 'Test dirección',
      lines: [{ productId: 1, quantity: '5', isRental: true }],
      ...over,
    }) as CreateOrderFormType;

  const quote = (over: Partial<CreateOrderFormType> = {}, products: Product[] = [product()]) =>
    fromOrderForm(
      {
        values: values(over),
        productsById: new Map(products.map((p) => [p.id, p])),
        clientName: 'Cliente de prueba',
        eventTypeName: 'Boda',
      },
      letterhead,
      ISSUED_AT,
    );

  it('prices from the form ESTIMATE, so it matches the total the admin is reading', () => {
    // Wed 11:50 → Fri 16:50 is 3 started days; 5 × Q10 × 3 = Q150. Identical to `orderEstimate`,
    // which is itself the mirror of the backend formula.
    const model = quote();
    expect(model?.groups[0]?.lines[0]).toMatchObject({ quantity: 5, unitPrice: 10, days: 3, total: 150 });
    expect(model?.totals.total).toBe(150);
  });

  it('says on its face that it is a PROPOSAL, not a record', () => {
    const model = quote();
    expect(model?.kind).toBe('quote');
    // No order exists yet, so there is no identity to print — and the file is named for the day.
    expect(model?.reference).toBeUndefined();
    // Named `dd-mm-yyyy`, the order this document's readers read dates in — and from LOCAL parts,
    // so a quote made in the evening is not filed under tomorrow.
    expect(documentFileName(model!)).toBe('cotizacion-05-08-2026.pdf');
    // Unlike a comprobante, a proposal expires: issued + the configured validity (15 in the fixture).
    expect(model?.validUntil).toEqual(new Date(2026, 7, 20, 15, 0));
    expect(model?.isPaid).toBe(false);
  });

  it('takes the validity window from the SETTING, whatever the admin sets it to', () => {
    // The number is `documents.quoteValidityDays` (Preferencias → Documentos, 1–365). Nothing in
    // the document knows "a week": moving it to 15 has to keep working exactly as well, so the
    // arithmetic is pinned at two values rather than at today's default.
    const withValidity = (days: number) =>
      fromOrderForm(
        {
          values: values(),
          productsById: new Map([[1, product()]]),
          clientName: 'Cliente de prueba',
          eventTypeName: 'Boda',
        },
        { ...letterhead, quoteValidityDays: days },
        ISSUED_AT,
      )?.validUntil;

    expect(withValidity(7)).toEqual(new Date(2026, 7, 12, 15, 0)); // 5 Aug + 7
    expect(withValidity(15)).toEqual(new Date(2026, 7, 20, 15, 0)); // 5 Aug + 15
    expect(withValidity(1)).toEqual(new Date(2026, 7, 6, 15, 0)); // the registry's floor
  });

  it('treats a BLANK delivery fee as unquoted and an explicit zero as free', () => {
    // Silence and "Gratis" are different promises. An empty field is a fee the admin has not
    // decided; printing it as free would commit the business to something nobody said.
    expect(quote({ deliveryAmount: '' })?.totals.delivery).toBeUndefined();
    expect(quote({ deliveryAmount: '0' })?.totals.delivery).toBe(0);
    expect(quote({ deliveryAmount: '75' })?.totals.total).toBe(225);
  });

  it('subtracts a deposit from the balance but never from the total', () => {
    const model = quote({ depositAmount: '50' });
    expect(model?.totals.total).toBe(150);
    expect(model?.totals.balance).toBe(100);
    // Clamped, like the comprobante's: a deposit above the total is a slip, not a credit.
    expect(quote({ depositAmount: '500' })?.totals.balance).toBe(0);
  });

  it('drops the pickup and the days for a purchase-only quote', () => {
    const model = quote(
      { lines: [{ productId: 2, quantity: '3', isRental: false }], pickupAt: '' },
      [product({ id: 2, businessTypeId: 2, sellPrice: 40, rentPrice: undefined })],
    );
    expect(model?.event.pickupAt).toBeUndefined();
    expect(model?.event.billedDays).toBeUndefined();
    expect(model?.groups[0]?.kind).toBe('sale');
    expect(model?.totals.total).toBe(120);
  });

  it('IGNORES a stale pickup when nothing is actually rented', () => {
    // The form hides the field for a purchase-only order, so a leftover value there is stale — the
    // same stance the schema's own pickup-coherence rule takes.
    const model = quote(
      { lines: [{ productId: 2, quantity: '1', isRental: false }], pickupAt: '2026-07-31T16:50' },
      [product({ id: 2, businessTypeId: 2, sellPrice: 40, rentPrice: undefined })],
    );
    expect(model?.event.pickupAt).toBeUndefined();
  });

  it('wears the currency of the products quoted, never a hardcoded Q', () => {
    const dollars = product({ currency: { id: 2, iso4217Code: 'USD', name: 'Dólar', symbol: '$' } as Product['currency'] });
    expect(quote({}, [dollars])?.currencySymbol).toBe('$');
  });

  it('produces NOTHING rather than a document built on values it cannot read', () => {
    // Both are defence in depth — the caller runs the form's resolver first — but a PDF with an
    // invented date or no priced line is worse than no PDF.
    expect(quote({ deliveryAt: 'no es una fecha' })).toBeUndefined();
    // Every line points at a product the cache no longer holds.
    expect(quote({}, [])).toBeUndefined();
  });
});

describe('documentReference / documentFileName', () => {
  it('zero-pads the order id so a stack of documents sorts and scans', () => {
    const model = fromOrderDetail(order(), letterhead, ISSUED_AT);
    expect(documentReference(model)).toBe('PED-00042');
    expect(documentFileName(model)).toBe('ped-00042.pdf');
  });

  it('names a document with no order after the DAY it was issued', () => {
    // A quote has no identity to borrow, and two quotes made on the same day would otherwise
    // collide on a name the browser would silently suffix.
    const model = fromOrderDetail(order(), letterhead, ISSUED_AT);
    delete model.reference;
    expect(documentReference(model)).toBeUndefined();
    // `dd-mm-yyyy`, from LOCAL parts — never `toISOString()`, which would file an evening quote in
    // Guatemala (UTC−6) under the following day.
    expect(documentFileName(model)).toBe('cotizacion-05-08-2026.pdf');
  });

  it('stamps the LOCAL day, not the UTC one', () => {
    // 21:00 in Guatemala is already tomorrow in UTC. The document says the 5th; the file must not
    // say the 6th.
    const model = fromOrderDetail(order(), letterhead, new Date(2026, 7, 5, 21, 30));
    delete model.reference;
    expect(documentFileName(model)).toBe('cotizacion-05-08-2026.pdf');
  });
});
