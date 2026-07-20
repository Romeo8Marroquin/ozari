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
  contactTypeId: 1,
  contactValue: '5555-1234',
  zoneId: 6,
  address: 'Zona 10, 4a avenida 5-55',
  ...overrides,
});

describe('createRegistrySchema', () => {
  const parse = (form: CreateRegistryFormType) => createRegistrySchema.safeParse(form);

  it('accepts a valid registry (with and without a zone)', () => {
    expect(parse(validForm()).success).toBe(true);
    expect(parse(validForm({ zoneId: null })).success).toBe(true);
  });

  it('rejects missing/invalid fields', () => {
    expect(parse(validForm({ name: 'x' })).success).toBe(false);
    expect(parse(validForm({ contactTypeId: null as unknown as number })).success).toBe(false);
    expect(parse(validForm({ contactValue: '' })).success).toBe(false);
    expect(parse(validForm({ address: 'abc' })).success).toBe(false);
  });

  it('exposes required-field patterns', () => {
    expect(createRegistryRequiredPatterns.length).toBeGreaterThan(0);
  });
});

describe('toCreateRegistryBody', () => {
  it('wraps the single contact/address as arrays of one, principal + favorite', () => {
    expect(toCreateRegistryBody(validForm())).toEqual({
      name: 'María López',
      contacts: [{ contactTypeId: 1, value: '5555-1234', isPrincipal: true }],
      addresses: [{ zoneId: 6, address: 'Zona 10, 4a avenida 5-55', isFavorite: true }],
    });
  });

  it('omits the zone when none is chosen and trims the text', () => {
    const body = toCreateRegistryBody(
      validForm({ zoneId: null, name: '  Doña María  ', address: '  Hacienda Real lote 5  ' }),
    );
    expect(body.addresses[0]).toEqual({ address: 'Hacienda Real lote 5', isFavorite: true });
    expect(body.name).toBe('Doña María');
  });

  it('has sane defaults', () => {
    expect(createRegistryDefaultValues.zoneId).toBeNull();
    expect(createRegistryDefaultValues.name).toBe('');
  });
});
