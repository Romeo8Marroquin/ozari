import { describe, expect, it } from 'vitest';
import {
  createOrderDefaultValues,
  createOrderRequiredPatterns,
  createOrderSchema,
  parseDateTime,
  parseLineQuantity,
  parseMoney,
  toCreateOrderBody,
  type CreateOrderFormType,
} from './SchemaCreateOrder';

const validForm = (overrides: Partial<CreateOrderFormType> = {}): CreateOrderFormType => ({
  clientRegistryId: 3,
  eventTypeId: 1,
  deliveryAt: '2026-08-01T14:00',
  pickupAt: '2026-08-02T10:00',
  deliveryName: 'María López',
  deliveryContact: '5555-1234',
  deliveryAddress: 'Zona 10, 4a avenida 5-55',
  description: '',
  comment: '',
  deliveryAmount: '',
  depositAmount: '',
  lines: [{ productId: 3, quantity: '25', isRental: true }],
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
});

describe('createOrderSchema', () => {
  const parse = (form: CreateOrderFormType) => createOrderSchema.safeParse(form);

  it('accepts a coherent rental order (pickup required + after delivery)', () => {
    expect(parse(validForm()).success).toBe(true);
  });

  it('accepts a purchase-only order with no pickup', () => {
    const result = parse(
      validForm({ pickupAt: '', lines: [{ productId: 4, quantity: '10', isRental: false }] }),
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

  it('rejects a duplicate product across lines', () => {
    const result = parse(
      validForm({
        lines: [
          { productId: 3, quantity: '1', isRental: true },
          { productId: 3, quantity: '2', isRental: true },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'lines.1.productId')).toBe(true);
  });

  it('requires at least one line, a client, an event type, and the snapshots', () => {
    expect(parse(validForm({ lines: [] })).success).toBe(false);
    expect(parse(validForm({ clientRegistryId: null as unknown as number })).success).toBe(false);
    expect(parse(validForm({ eventTypeId: null as unknown as number })).success).toBe(false);
    expect(parse(validForm({ deliveryAt: '' })).success).toBe(false);
    expect(parse(validForm({ deliveryName: 'x' })).success).toBe(false);
    expect(parse(validForm({ deliveryContact: '' })).success).toBe(false);
    expect(parse(validForm({ deliveryAddress: 'abc' })).success).toBe(false);
  });

  it('rejects invalid line quantities and money fields', () => {
    expect(parse(validForm({ lines: [{ productId: 3, quantity: '0', isRental: true }] })).success).toBe(false);
    expect(parse(validForm({ deliveryAmount: '-5' })).success).toBe(false);
    expect(parse(validForm({ depositAmount: 'abc' })).success).toBe(false);
  });

  it('exposes required-field patterns for the marker', () => {
    expect(createOrderRequiredPatterns.length).toBeGreaterThan(0);
  });
});

describe('toCreateOrderBody', () => {
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
      lines: [{ productId: 3, quantity: 25 }],
    });
    expect(body.deliveryAt).toMatch(/^2026-08-01T/);
    expect(body.pickupAt).toMatch(/^2026-08-02T/);
    expect(body.comment).toBeUndefined();
  });

  it('omits the pickup and money for a purchase-only order with none set', () => {
    const body = toCreateOrderBody(
      validForm({ pickupAt: '', lines: [{ productId: 4, quantity: '10', isRental: false }] }),
    );
    expect(body.pickupAt).toBeUndefined();
    expect(body.deliveryAmount).toBeUndefined();
    expect(body.depositAmount).toBeUndefined();
  });

  it('includes a trimmed comment when present', () => {
    const body = toCreateOrderBody(validForm({ comment: '  llamar al llegar  ' }));
    expect(body.comment).toBe('llamar al llegar');
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
  });
});
