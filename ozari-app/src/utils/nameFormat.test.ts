import { describe, expect, it } from 'vitest';
import { getFirstName, getInitials } from './nameFormat';

describe('getInitials (Guatemalan naming convention)', () => {
  it.each([
    ['', ''],
    ['   ', ''],
    ['Madonna', 'M'],
    ['Juan Pérez', 'JP'],
    ['Ana María López', 'AL'], // 3 parts → first name + last part
    ['Ana María López Pérez', 'AL'], // 4 parts → first name + first surname (3rd)
    ['Ana María de la Cruz Pérez', 'AL'], // 5+ parts → first name + 4th part
  ])('"%s" → "%s"', (input, expected) => {
    expect(getInitials(input)).toBe(expected);
  });

  it('uppercases with Spanish rules and takes whole accented graphemes', () => {
    expect(getInitials('álvaro énriquez')).toBe('ÁÉ');
    expect(getInitials('ñoño ñandú')).toBe('ÑÑ');
  });

  it('collapses arbitrary whitespace between parts', () => {
    expect(getInitials('  Juan   Pérez  ')).toBe('JP');
  });
});

describe('getFirstName', () => {
  it('returns the first given name only', () => {
    expect(getFirstName('Ana María López Pérez')).toBe('Ana');
    expect(getFirstName('  Juan  ')).toBe('Juan');
  });

  it('returns empty string for a blank name', () => {
    expect(getFirstName('')).toBe('');
    expect(getFirstName('   ')).toBe('');
  });
});
