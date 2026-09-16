import { describe, expect, it } from 'vitest';
import { decimalInput, integerInput, toDecimalText, toIntegerText } from './numericInput';

describe('toIntegerText', () => {
  it('keeps digits and drops everything else', () => {
    expect(toIntegerText('12')).toBe('12');
    expect(toIntegerText('1a2')).toBe('12');
    // The three characters a `decimal` keyboard offers beside the digits, and the ones a
    // `type="number"` input would have turned the whole value into `''` over.
    expect(toIntegerText('1.5')).toBe('15');
    expect(toIntegerText('-3')).toBe('3');
    expect(toIntegerText('1e5')).toBe('15');
    expect(toIntegerText('')).toBe('');
  });
});

describe('toDecimalText', () => {
  it('keeps a plain amount untouched', () => {
    expect(toDecimalText('120')).toBe('120');
    expect(toDecimalText('120.5')).toBe('120.5');
    expect(toDecimalText('120.55')).toBe('120.55');
  });

  it('accepts the comma the Spanish keyboards offer as the decimal key', () => {
    expect(toDecimalText('120,5')).toBe('120.5');
  });

  it('survives the middle of typing', () => {
    // A trailing point is `120.` on the way to `120.5`, and must not be eaten as the user types it.
    expect(toDecimalText('120.')).toBe('120.');
    expect(toDecimalText('.5')).toBe('.5');
  });

  it('allows only one point, keeping the digits in the order they were typed', () => {
    expect(toDecimalText('1.2.3')).toBe('1.23');
  });

  it('stops at cents, and drops what is not a number', () => {
    expect(toDecimalText('1.239')).toBe('1.23');
    expect(toDecimalText('Q 1.50')).toBe('1.50');
    expect(toDecimalText('-1.50')).toBe('1.50');
  });
});

describe('the field bundles', () => {
  it('ask for a text input and the right mobile keyboard', () => {
    // `type: 'text'`, never `number` — the whole point of the module.
    expect(integerInput).toMatchObject({ type: 'text', inputMode: 'numeric' });
    expect(decimalInput).toMatchObject({ type: 'text', inputMode: 'decimal' });
    expect(integerInput.transform).toBe(toIntegerText);
    expect(decimalInput.transform).toBe(toDecimalText);
  });
});
