import type { ResolverResult } from 'react-hook-form';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Product, ProductVariant } from '../products/product.types';
import {
  appendDriverConflictErrors,
  appendLineAvailabilityErrors,
  appendLineVariantErrors,
  availabilityMapFrom,
  createOrderDefaultValues,
  gapLabelKey,
  createOrderRequiredPatterns,
  createOrderSchema,
  nowDateTimeLocal,
  orderToFormValues,
  parseDateTime,
  parseLineQuantity,
  parseMoney,
  takeableFor,
  toCreateOrderBody,
  toDateTimeLocal,
  type CreateOrderFormType,
} from './SchemaCreateOrder';

// Freeze "now" well before the fixtures' 2026-08 dates so the not-in-past delivery refine is
// deterministic (and the hardcoded future fixtures never go stale as the wall clock advances).
const FROZEN_NOW = new Date('2026-07-15T12:00:00').getTime();
beforeAll(() => vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW));
afterAll(() => vi.restoreAllMocks());

const PIN = { lat: 14.634915, lng: -90.506883 };

const variant = (overrides: Partial<ProductVariant> = {}): ProductVariant => ({
  id: 71,
  valueIds: [1],
  label: 'Rojo',
  isDefault: false,
  ...overrides,
});

/** One form line (no variation unless given). */
const ln = (
  productId: number,
  quantity: string,
  isRental: boolean,
  variantId: number | null = null,
): CreateOrderFormType['lines'][number] => ({ productId, variantId, pickedValues: [], quantity, isRental });

const validForm = (overrides: Partial<CreateOrderFormType> = {}): CreateOrderFormType => ({
  clientRegistryId: 3,
  eventTypeId: 1,
  deliveryAt: '2026-08-01T14:00',
  pickupAt: '2026-08-02T10:00',
  deliveryName: 'María López',
  deliveryContact: '5555-1234',
  deliveryContactTypeId: null,
  deliveryZoneId: null,
  deliveryAddress: 'Zona 10, 4a avenida 5-55',
  // No pin — the default state of nearly every order.
  deliveryCoords: null,
  deliveryInstructions: '',
  description: '',
  comment: '',
  deliveryAmount: '',
  depositAmount: '',
  assignedUserId: 2,
  lines: [ln(3, '25', true)],
  ...overrides,
});

describe('parse helpers', () => {
  it('parseMoney: absent, valid, and invalid', () => {
    expect(parseMoney('')).toBeUndefined();
    expect(parseMoney('  ')).toBeUndefined();
    expect(parseMoney('50')).toBe(50);
    expect(parseMoney('-1')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('99999999')).toBeNull();
  });

  it('parseLineQuantity: required positive integer', () => {
    expect(parseLineQuantity('')).toBeNull();
    expect(parseLineQuantity('0')).toBeNull();
    expect(parseLineQuantity('2.5')).toBeNull();
    expect(parseLineQuantity('25')).toBe(25);
    expect(parseLineQuantity('99999')).toBeNull();
  });

  it('parseDateTime: valid, empty, invalid', () => {
    expect(parseDateTime('2026-08-01T14:00')).toBeInstanceOf(Date);
    expect(parseDateTime('')).toBeNull();
    expect(parseDateTime('not-a-date')).toBeNull();
  });

  it('nowDateTimeLocal: the current instant as a datetime-local value', () => {
    // Frozen to 2026-07-15T12:00 → the picker `min` reflects "now" in the local datetime-local shape.
    expect(nowDateTimeLocal()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(nowDateTimeLocal()).toBe('2026-07-15T12:00');
  });
});

describe('createOrderSchema', () => {
  const parse = (form: CreateOrderFormType) => createOrderSchema.safeParse(form);

  it('accepts a coherent rental order (pickup required + after delivery)', () => {
    expect(parse(validForm()).success).toBe(true);
  });

  it('accepts a purchase-only order with no pickup', () => {
    const result = parse(
      validForm({ pickupAt: '', lines: [ln(4, '10', false)] }),
    );
    expect(result.success).toBe(true);
  });

  it('requires a pickup when any line is a rental', () => {
    const result = parse(validForm({ pickupAt: '' }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'pickupAt')).toBe(true);
  });

  it('rejects a pickup that is not after the delivery', () => {
    const result = parse(validForm({ pickupAt: '2026-08-01T13:00' }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'pickupAt')).toBe(true);
  });

  it('rejects an unparseable pickup for a rental order', () => {
    const result = parse(validForm({ pickupAt: 'nonsense' }));
    expect(result.success).toBe(false);
  });

  it('skips the ordering check when the delivery date itself is invalid', () => {
    // anyRental + a valid pickup but an unparseable delivery → the pickup-vs-delivery comparison
    // is skipped (deliveryDate is null); the delivery field carries its own error.
    const result = parse(validForm({ deliveryAt: 'nonsense', pickupAt: '2026-08-02T10:00' }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'deliveryAt')).toBe(true);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'pickupAt')).toBe(false);
  });

  it('rejects a delivery scheduled in the past', () => {
    const result = parse(validForm({ deliveryAt: '2020-01-01T00:00' }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'deliveryAt')).toBe(true);
  });

  it('accepts a delivery at the current minute (the picker minimum, within the grace)', () => {
    const result = parse(validForm({ deliveryAt: nowDateTimeLocal(), pickupAt: '2026-08-02T10:00' }));
    expect(result.success).toBe(true);
  });

  it('rejects a duplicate product across lines', () => {
    const result = parse(
      validForm({
        lines: [
          ln(3, '1', true),
          ln(3, '2', true),
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'lines.1.productId')).toBe(true);
  });

  it('identifies a line by its (product, variation) PAIR: two colours pass, the same colour twice does not', () => {
    expect(parse(validForm({ lines: [ln(7, '1', true, 71), ln(7, '2', true, 72)] })).success).toBe(true);
    const result = parse(validForm({ lines: [ln(7, '1', true, 71), ln(7, '2', true, 71)] }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'lines.1.productId')).toBe(true);
  });

  it('sends the variation only on a line that has one, and an edit restores it', () => {
    const body = toCreateOrderBody(validForm({ lines: [ln(7, '2', true, 71), ln(3, '1', true)] }));
    expect(body.lines).toEqual([
      { productId: 7, variantId: 71, quantity: 2 },
      { productId: 3, quantity: 1 },
    ]);
  });

  it('requires at least one line, a client, an event type, and the snapshots', () => {
    expect(parse(validForm({ lines: [] })).success).toBe(false);
    expect(parse(validForm({ clientRegistryId: null as unknown as number })).success).toBe(false);
    expect(parse(validForm({ assignedUserId: null as unknown as number })).success).toBe(false);
    expect(parse(validForm({ eventTypeId: null as unknown as number })).success).toBe(false);
    expect(parse(validForm({ deliveryAt: '' })).success).toBe(false);
    expect(parse(validForm({ deliveryName: 'x' })).success).toBe(false);
    expect(parse(validForm({ deliveryContact: '' })).success).toBe(false);
    expect(parse(validForm({ deliveryAddress: 'abc' })).success).toBe(false);
  });

  it('rejects invalid line quantities and money fields', () => {
    expect(parse(validForm({ lines: [ln(3, '0', true)] })).success).toBe(false);
    expect(parse(validForm({ deliveryAmount: '-5' })).success).toBe(false);
    expect(parse(validForm({ depositAmount: 'abc' })).success).toBe(false);
  });

  it('exposes required-field patterns for the marker', () => {
    expect(createOrderRequiredPatterns.length).toBeGreaterThan(0);
  });
});

describe('toCreateOrderBody', () => {
  it('sends the map pin only when there IS one', () => {
    // Absent, not null: most orders have no pin, and the payload should say nothing about it.
    expect(toCreateOrderBody(validForm())).not.toHaveProperty('deliveryCoords');
    expect(toCreateOrderBody(validForm({ deliveryCoords: PIN }))).toMatchObject({
      deliveryCoords: PIN,
    });
  });

  it('sends the arrival instructions only when written, trimmed', () => {
    expect(toCreateOrderBody(validForm())).not.toHaveProperty('deliveryInstructions');
    expect(toCreateOrderBody(validForm({ deliveryInstructions: '   ' }))).not.toHaveProperty(
      'deliveryInstructions',
    );
    expect(
      toCreateOrderBody(validForm({ deliveryInstructions: '  Portón negro  ' })),
    ).toMatchObject({ deliveryInstructions: 'Portón negro' });
  });

  it('maps a rental order to ISO dates, numeric lines, and truncated money', () => {
    const body = toCreateOrderBody(
      validForm({ deliveryAmount: '50.999', depositAmount: '100', description: '  nota  ', comment: '' }),
    );
    expect(body).toMatchObject({
      clientRegistryId: 3,
      eventTypeId: 1,
      deliveryName: 'María López',
      deliveryContact: '5555-1234',
      deliveryAddress: 'Zona 10, 4a avenida 5-55',
      deliveryAmount: 50.99,
      depositAmount: 100,
      description: 'nota',
      assignedUserId: 2,
      lines: [{ productId: 3, quantity: 25 }],
    });
    expect(body.deliveryAt).toMatch(/^2026-08-01T/);
    expect(body.pickupAt).toMatch(/^2026-08-02T/);
    expect(body.comment).toBeUndefined();
  });

  it('omits the pickup and money for a purchase-only order with none set', () => {
    const body = toCreateOrderBody(
      validForm({ pickupAt: '', lines: [ln(4, '10', false)] }),
    );
    expect(body.pickupAt).toBeUndefined();
    expect(body.deliveryAmount).toBeUndefined();
    expect(body.depositAmount).toBeUndefined();
  });

  it('includes a trimmed comment when present', () => {
    const body = toCreateOrderBody(validForm({ comment: '  llamar al llegar  ' }));
    expect(body.comment).toBe('llamar al llegar');
  });

  it('never carries a payment METHOD — that is recorded when the money arrives', () => {
    // `services.paymentMethodId` says how the order was actually PAID, which has not happened while
    // the form is open. It is collected once, by "Registrar pago" (owner decision 2026-08-05).
    expect(toCreateOrderBody(validForm())).not.toHaveProperty('paymentMethodId');
  });

  it('omits empty optional text/money fields', () => {
    const body = toCreateOrderBody(validForm({ description: '', comment: '', deliveryAmount: '', depositAmount: '' }));
    expect(body.description).toBeUndefined();
    expect(body.comment).toBeUndefined();
    expect(body.deliveryAmount).toBeUndefined();
    expect(body.depositAmount).toBeUndefined();
  });

  it('has sane defaults', () => {
    expect(createOrderDefaultValues.lines).toEqual([]);
    expect(createOrderDefaultValues.deliveryAt).toBe('');
    expect(createOrderDefaultValues).not.toHaveProperty('paymentMethodId');
  });
});

describe('availabilityMapFrom', () => {
  it('keys every product AND every variation by its pair', () => {
    const map = availabilityMapFrom([
      { productId: 3, available: 4 },
      { productId: 7, available: 9, variants: [{ variantId: 71, available: 5 }, { variantId: 72, available: null }] },
    ]);
    expect(map.get('3:')).toBe(4);
    expect(map.get('7:')).toBe(9);
    expect(map.get('7:71')).toBe(5);
    expect(map.get('7:72')).toBeNull();
  });
});

describe('takeableFor', () => {
  const products = new Map<number, Pick<Product, 'available' | 'variants'>>([
    [3, { available: 10 }],
    [4, { available: 8 }],
    [5, {}], // no baseline
    [7, { available: 9, variants: [variant({ id: 71, available: 6 }), variant({ id: 72 })] }],
  ]);

  it('prefers the fetched window amount, else the product baseline, else undefined', () => {
    const windowAvail = new Map<string, number | null>([
      ['3:', 4],
      ['4:', null], // a rental with no pickup yet → fall back to the baseline
    ]);
    expect(takeableFor(3, null, windowAvail, products)).toBe(4); // window amount wins
    expect(takeableFor(4, undefined, windowAvail, products)).toBe(8); // window null → baseline
    expect(takeableFor(5, null, new Map(), products)).toBeUndefined(); // no window, no baseline
    expect(takeableFor(9, null, new Map(), products)).toBeUndefined(); // unknown product
  });

  it('answers per VARIATION: its window amount, else its own baseline — never the product sum', () => {
    expect(takeableFor(7, 71, new Map([['7:71', 2]]), products)).toBe(2);
    expect(takeableFor(7, 71, new Map(), products)).toBe(6);
    expect(takeableFor(7, 72, new Map(), products)).toBeUndefined(); // no baseline on it
    expect(takeableFor(7, 99, new Map(), products)).toBeUndefined(); // not offered
    expect(takeableFor(8, 81, new Map(), products)).toBeUndefined(); // unknown product
  });
});

describe('appendLineVariantErrors', () => {
  const messages = { required: 'pick one', invalid: 'gone' };
  const ok = (form: CreateOrderFormType): ResolverResult<CreateOrderFormType> => ({ values: form, errors: {} });
  type LineErrors = ({ variantId?: { message?: string }; productId?: { message?: string } } | undefined)[];
  const lineErrorsOf = (result: ResolverResult<CreateOrderFormType>): LineErrors | undefined =>
    (result.errors as { lines?: LineErrors }).lines;
  const products = new Map<number, Pick<Product, 'variants'>>([
    [3, {}],
    [7, { variants: [variant({ id: 71 })] }],
  ]);

  it('returns the same result when every line is fine', () => {
    const form = validForm({
      lines: [ln(3, '1', true), ln(7, '1', true, 71), ln(null as unknown as number, '1', true), ln(9, '1', true)],
    });
    const result = ok(form);
    expect(appendLineVariantErrors(form, result, products, messages)).toBe(result);
  });

  it('requires a variation on a product that has them, and flags one no longer offered', () => {
    const form = validForm({ lines: [ln(3, '1', true), ln(7, '1', true), ln(7, '2', true, 99)] });
    const out = appendLineVariantErrors(form, ok(form), products, messages);
    expect(out.values).toEqual({});
    expect(lineErrorsOf(out)?.[0]).toBeUndefined();
    expect(lineErrorsOf(out)?.[1]?.variantId?.message).toBe('pick one');
    expect(lineErrorsOf(out)?.[2]?.variantId?.message).toBe('gone');
  });

  it('leaves a line whose PRODUCT already errs alone, and keeps base errors on other lines', () => {
    const form = validForm({ lines: [ln(7, '1', true), ln(7, '1', true), ln(3, '1', true)] });
    const base: ResolverResult<CreateOrderFormType> = {
      values: {},
      errors: { lines: [{ productId: { type: 'x', message: 'dup' } }, undefined, { productId: { type: 'x', message: 'own' } }] } as never,
    };
    const out = appendLineVariantErrors(form, base, products, messages);
    expect(lineErrorsOf(out)?.[0]?.productId?.message).toBe('dup');
    expect(lineErrorsOf(out)?.[0]?.variantId).toBeUndefined();
    expect(lineErrorsOf(out)?.[1]?.variantId?.message).toBe('pick one');
    expect(lineErrorsOf(out)?.[2]?.productId?.message).toBe('own');
  });
});
describe('appendLineAvailabilityErrors', () => {
  const message = (available: number) => `max ${available}`;
  const ok = (form: CreateOrderFormType): ResolverResult<CreateOrderFormType> => ({ values: form, errors: {} });
  type LineErrors = ({ quantity?: { message?: string }; productId?: { message?: string } } | undefined)[];
  const lineErrorsOf = (result: ResolverResult<CreateOrderFormType>): LineErrors | undefined =>
    (result.errors as { lines?: LineErrors }).lines;

  it('leaves a within-cap order untouched (returns the same result)', () => {
    const form = validForm({ lines: [ln(3, '4', true)] });
    const result = ok(form);
    expect(appendLineAvailabilityErrors(form, result, () => 10, message)).toBe(result);
  });

  it('flags a line over its cap, leaves a within-cap sibling clean, and marks the form invalid', () => {
    const form = validForm({
      lines: [
        ln(3, '25', true), // over cap → error
        ln(4, '2', false), // within cap → stays clean
      ],
    });
    const out = appendLineAvailabilityErrors(form, ok(form), (line) => (line.productId === 3 ? 4 : 10), message);
    expect(out.values).toEqual({});
    expect(lineErrorsOf(out)?.[0]?.quantity?.message).toBe('max 4');
    expect(lineErrorsOf(out)?.[1]).toBeUndefined();
  });

  it('never overwrites a schema error already on a quantity, and skips null-product / unknown-cap lines', () => {
    const form = validForm({
      lines: [
        ln(3, '25', true), // valid + over cap, but a schema error owns it
        ln(null as unknown as number, '5', false), // no product → skipped
        ln(5, '99', false), // unknown cap → left to the server
      ],
    });
    const base: ResolverResult<CreateOrderFormType> = {
      values: {},
      errors: { lines: [{ quantity: { type: 'too_small', message: 'schema' } }, undefined, undefined] } as never,
    };
    const capFor = (line: { productId: number }) => (line.productId === 5 ? undefined : 1);
    // Nothing new added anywhere → the original result is returned unchanged.
    expect(appendLineAvailabilityErrors(form, base, capFor, message)).toBe(base);
  });

  it('adds an availability error while preserving a base error on another line', () => {
    const form = validForm({
      lines: [
        ln(3, '25', true), // over cap → availability error added
        ln(4, '2', false), // a base productId error must survive
      ],
    });
    const base: ResolverResult<CreateOrderFormType> = {
      values: {},
      errors: { lines: [undefined, { productId: { type: 'x', message: 'dup' } }] } as never,
    };
    const out = appendLineAvailabilityErrors(form, base, () => 4, message);
    expect(lineErrorsOf(out)?.[0]?.quantity?.message).toBe('max 4');
    expect(lineErrorsOf(out)?.[1]?.productId?.message).toBe('dup');
  });
});

describe('gapLabelKey', () => {
  it('reads whole hours as hours and everything else as minutes', () => {
    expect(gapLabelKey(60)).toEqual({ key: 'gapHours', count: 1 });
    expect(gapLabelKey(120)).toEqual({ key: 'gapHours', count: 2 });
    expect(gapLabelKey(45)).toEqual({ key: 'gapMinutes', count: 45 });
    expect(gapLabelKey(90)).toEqual({ key: 'gapMinutes', count: 90 });
  });

  it('does not call zero "0 horas"', () => {
    // Defensive: a payload without a gap must not read as an hour-shaped sentence.
    expect(gapLabelKey(0)).toEqual({ key: 'gapMinutes', count: 0 });
  });
});

describe('appendDriverConflictErrors', () => {
  const base = (): ResolverResult<CreateOrderFormType> => ({ values: {}, errors: {} });
  const messages = {
    conflict: (driverName: string, at: string) => `busy ${driverName} ${at}`,
    selfOverlap: (gapMinutes: number) => `apart ${gapMinutes}`,
  };
  const conflict = (blocks: 'DELIVERY' | 'COLLECTION') => ({
    orderId: 42,
    at: '2026-08-01T14:30:00.000Z',
    kind: 'DELIVERY' as const,
    blocks,
  });
  const fieldErrors = (result: ResolverResult<CreateOrderFormType>) =>
    result.errors as Record<string, { message?: string } | undefined>;

  it('says nothing when there is no answer yet, or the driver is free', () => {
    const result = base();
    expect(appendDriverConflictErrors(undefined, result, messages)).toBe(result);
    expect(appendDriverConflictErrors({ available: true }, result, messages)).toBe(result);
    // An unavailable answer with nothing to report can't invent a message either.
    expect(appendDriverConflictErrors({ available: false }, result, messages)).toBe(result);
  });

  it('lands a clash on the date field it actually blocks — never on both', () => {
    const onPickup = appendDriverConflictErrors(
      { available: false, driverName: 'Ana', conflicts: [conflict('COLLECTION')] },
      base(),
      messages,
    );
    expect(fieldErrors(onPickup)['pickupAt']?.message).toBe('busy Ana 2026-08-01T14:30:00.000Z');
    expect(fieldErrors(onPickup)['deliveryAt']).toBeUndefined();

    const onDelivery = appendDriverConflictErrors(
      { available: false, driverName: 'Ana', conflicts: [conflict('DELIVERY')] },
      base(),
      messages,
    );
    expect(fieldErrors(onDelivery)['deliveryAt']?.message).toBeTruthy();
    expect(fieldErrors(onDelivery)['pickupAt']).toBeUndefined();
  });

  it('marks the PICKUP for a self-overlap and keeps that message over a later clash', () => {
    const out = appendDriverConflictErrors(
      {
        available: false,
        selfOverlap: true,
        gapMinutes: 60,
        conflicts: [conflict('COLLECTION')],
      },
      base(),
      messages,
    );
    // The order's own two events being impossible is the more specific fault — it wins the field.
    expect(fieldErrors(out)['pickupAt']?.message).toBe('apart 60');
  });

  it('never overwrites a schema error already on the date', () => {
    const withSchemaError: ResolverResult<CreateOrderFormType> = {
      values: {},
      errors: { deliveryAt: { type: 'custom', message: 'schema' } } as never,
    };
    const out = appendDriverConflictErrors(
      { available: false, conflicts: [conflict('DELIVERY')] },
      withSchemaError,
      messages,
    );
    expect(fieldErrors(out)['deliveryAt']?.message).toBe('schema');
  });

  it('falls back to an empty name and a zero gap rather than printing "undefined"', () => {
    // The client tier answers `{ available: false }` alone; the admin one always names the driver.
    const out = appendDriverConflictErrors(
      { available: false, selfOverlap: true, conflicts: [conflict('DELIVERY')] },
      base(),
      messages,
    );
    expect(fieldErrors(out)['pickupAt']?.message).toBe('apart 0');
    expect(fieldErrors(out)['deliveryAt']?.message).toBe('busy  2026-08-01T14:30:00.000Z');
  });
});

describe('orderToFormValues', () => {
  it('reopens on the ORDER’s own pin, and on null when it had none', () => {
    // The snapshot, not the registry's current pin — the venue may have been re-pinned since.
    expect(orderToFormValues(order({ deliveryCoords: PIN })).deliveryCoords).toEqual(PIN);
    expect(orderToFormValues(order()).deliveryCoords).toBeNull();
  });

  /** The order as `GET /orders/:id` returns it — ISO instants, numbers, optional fields absent. */
  const order = (overrides: Record<string, unknown> = {}) =>
    ({
      clientRegistryId: 3,
      eventType: { id: 1 },
      deliveryAt: new Date('2026-08-01T14:00:00').toISOString(),
      pickupAt: new Date('2026-08-02T10:30:00').toISOString(),
      clientName: 'María López',
      deliveryContact: '5555-1234',
      deliveryAddress: 'Zona 10, 4a avenida 5-55',
      deliveryAmount: 50,
      depositAmount: 100,
      paymentMethod: { id: 2 },
      assignee: { id: 5 },
      lines: [
        { productId: 3, quantity: 25, isRental: true },
        { productId: 4, quantity: 10, isRental: false },
      ],
      ...overrides,
    }) as Parameters<typeof orderToFormValues>[0];

  it('round-trips: what the form sends back for an untouched order is what it already had', () => {
    const values = orderToFormValues(order());
    // The pickers hold LOCAL `datetime-local` strings — the order was scheduled on the business's
    // own clock, and the field carries no timezone.
    expect(values.deliveryAt).toBe('2026-08-01T14:00');
    expect(values.pickupAt).toBe('2026-08-02T10:30');
    expect(values.lines).toEqual([
      ln(3, '25', true),
      ln(4, '10', false),
    ]);

    const body = toCreateOrderBody(values);
    expect(body).toMatchObject({
      clientRegistryId: 3,
      eventTypeId: 1,
      deliveryName: 'María López',
      deliveryContact: '5555-1234',
      deliveryAddress: 'Zona 10, 4a avenida 5-55',
      deliveryAmount: 50,
      depositAmount: 100,
      assignedUserId: 5,
      lines: [
        { productId: 3, quantity: 25 },
        { productId: 4, quantity: 10 },
      ],
    });
    expect(new Date(body.deliveryAt).getTime()).toBe(new Date(order().deliveryAt).getTime());
  });

  it('restores a line VARIATION (and starts with no partial picks)', () => {
    const values = orderToFormValues(
      order({ lines: [{ productId: 7, variantId: 71, quantity: 2, isRental: true }] }),
    );
    expect(values.lines).toEqual([ln(7, '2', true, 71)]);
    expect(toCreateOrderBody(values).lines).toEqual([{ productId: 7, variantId: 71, quantity: 2 }]);
  });

  it('leaves absent fields empty rather than inventing values', () => {
    const values = orderToFormValues(
      order({
        pickupAt: undefined,
        description: undefined,
        comment: undefined,
        deliveryAmount: undefined,
        depositAmount: undefined,
        paymentMethod: undefined,
        lines: [{ productId: 4, quantity: 2, isRental: false }],
      }),
    );
    expect(values.pickupAt).toBe('');
    expect(values.description).toBe('');
    expect(values.comment).toBe('');
    expect(values.deliveryAmount).toBe('');
    expect(values.depositAmount).toBe('');
    // Reopening an order never restores a payment method into the FORM: an edit cannot change how
    // the order was paid, so the field does not exist here at all.
    expect(values).not.toHaveProperty('paymentMethodId');
    // A purchase-only order sends no pickup at all (the mode rule, mirrored).
    expect(toCreateOrderBody(values).pickupAt).toBeUndefined();
  });

  it('restores the optional TEXTS an order does carry', () => {
    const values = orderToFormValues(
      order({ description: 'Cumpleaños en el jardín', comment: 'Llamar al llegar' }),
    );
    expect(values.description).toBe('Cumpleaños en el jardín');
    expect(values.comment).toBe('Llamar al llegar');
  });

  it('does NOT restore the form-only aids — they were never part of the order', () => {
    // `deliveryContactTypeId` picks an icon/keyboard and `deliveryZoneId` suggests a fee; what an
    // order records is the agreed TEXT. Guessing them from the registry would let a later zone
    // change silently rewrite the fee that was actually agreed.
    const values = orderToFormValues(order());
    expect(values.deliveryContactTypeId).toBeNull();
    expect(values.deliveryZoneId).toBeNull();
  });

  it('pads every part of the datetime-local value', () => {
    expect(toDateTimeLocal(new Date('2026-01-05T09:07:00').toISOString())).toBe('2026-01-05T09:07');
  });
});
