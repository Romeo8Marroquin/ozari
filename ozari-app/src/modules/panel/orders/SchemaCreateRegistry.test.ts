import { describe, expect, it } from 'vitest';
import {
  createRegistryDefaultValues,
  createRegistryRequiredPatterns,
  createRegistrySchema,
  toCreateRegistryBody,
  type CreateRegistryFormType,
} from './SchemaCreateRegistry';

const validForm = (overrides: Partial<CreateRegistryFormType> = {}): CreateRegistryFormType => ({
  name: 'María López',
  contacts: [{ contactTypeId: 1, value: '5555-1234' }],
  addresses: [{ zoneId: 6, address: 'Zona 10, 4a avenida 5-55' }],
  principalContactIndex: 0,
  favoriteAddressIndex: 0,
  preferredPaymentMethodId: null,
  ...overrides,
});

describe('createRegistrySchema', () => {
  const parse = (form: CreateRegistryFormType) => createRegistrySchema.safeParse(form);

  it('accepts a valid registry (with a zone, without a zone, and with NO addresses)', () => {
    expect(parse(validForm()).success).toBe(true);
    expect(parse(validForm({ addresses: [{ zoneId: null, address: 'Hacienda Real lote 5' }] })).success).toBe(true);
    expect(parse(validForm({ addresses: [] })).success).toBe(true);
  });

  it('accepts multiple contacts and addresses with a preferred method', () => {
    const result = parse(
      validForm({
        contacts: [
          { contactTypeId: 1, value: '5555-1234' },
          { contactTypeId: 3, value: 'maria@example.com' },
        ],
        addresses: [
          { zoneId: 6, address: 'Zona 10, 4a avenida 5-55' },
          { zoneId: null, address: 'Hacienda Real lote 5' },
        ],
        principalContactIndex: 1,
        favoriteAddressIndex: 1,
        preferredPaymentMethodId: 2,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('requires at least one contact', () => {
    expect(parse(validForm({ contacts: [] })).success).toBe(false);
  });

  it('rejects missing/invalid fields', () => {
    expect(parse(validForm({ name: 'x' })).success).toBe(false);
    expect(parse(validForm({ contacts: [{ contactTypeId: null as unknown as number, value: '5555' }] })).success).toBe(false);
    expect(parse(validForm({ contacts: [{ contactTypeId: 1, value: '' }] })).success).toBe(false);
    expect(parse(validForm({ addresses: [{ zoneId: 6, address: 'abc' }] })).success).toBe(false);
  });

  it('exposes required-field patterns', () => {
    expect(createRegistryRequiredPatterns.length).toBeGreaterThan(0);
  });
});

describe('toCreateRegistryBody', () => {
  it('maps the chosen principal/favorite indexes onto the arrays and trims text', () => {
    const body = toCreateRegistryBody(
      validForm({
        name: '  Doña María  ',
        contacts: [
          { contactTypeId: 1, value: '  5555-1234  ' },
          { contactTypeId: 3, value: 'maria@example.com' },
        ],
        addresses: [
          { zoneId: 6, address: '  Zona 10, 4a avenida 5-55  ' },
          { zoneId: null, address: 'Hacienda Real lote 5' },
        ],
        principalContactIndex: 1,
        favoriteAddressIndex: 1,
        preferredPaymentMethodId: 2,
      }),
    );
    expect(body.name).toBe('Doña María');
    expect(body.contacts).toEqual([
      { contactTypeId: 1, value: '5555-1234', isPrincipal: false },
      { contactTypeId: 3, value: 'maria@example.com', isPrincipal: true },
    ]);
    expect(body.addresses).toEqual([
      { zoneId: 6, address: 'Zona 10, 4a avenida 5-55', isFavorite: false },
      { address: 'Hacienda Real lote 5', isFavorite: true },
    ]);
    expect(body.preferredPaymentMethodId).toBe(2);
  });

  it('omits the zone and the preferred method when none is chosen', () => {
    const body = toCreateRegistryBody(
      validForm({ addresses: [{ zoneId: null, address: 'Hacienda Real lote 5' }], preferredPaymentMethodId: null }),
    );
    expect(body.addresses[0]).toEqual({ address: 'Hacienda Real lote 5', isFavorite: true });
    expect(body.preferredPaymentMethodId).toBeUndefined();
  });

  it('has sane defaults', () => {
    expect(createRegistryDefaultValues.name).toBe('');
    expect(createRegistryDefaultValues.contacts).toHaveLength(1);
    expect(createRegistryDefaultValues.addresses).toHaveLength(1);
    expect(createRegistryDefaultValues.preferredPaymentMethodId).toBeNull();
  });
});
