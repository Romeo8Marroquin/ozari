import { describe, expect, it } from 'vitest';
import { sanitizeLoginRedirect } from './loginRedirect';

describe('sanitizeLoginRedirect', () => {
  it('passes in-panel paths through, with params and query strings intact', () => {
    expect(sanitizeLoginRedirect('/panel')).toBe('/panel');
    expect(sanitizeLoginRedirect('/panel/productos')).toBe('/panel/productos');
    expect(sanitizeLoginRedirect('/panel/productos/6')).toBe('/panel/productos/6');
    expect(sanitizeLoginRedirect('/panel/productos?search=mesa&categoryId=2')).toBe(
      '/panel/productos?search=mesa&categoryId=2',
    );
    expect(sanitizeLoginRedirect('/panel?tab=x')).toBe('/panel?tab=x');
  });

  it('drops non-strings and non-panel destinations', () => {
    expect(sanitizeLoginRedirect(undefined)).toBeUndefined();
    expect(sanitizeLoginRedirect(42)).toBeUndefined();
    expect(sanitizeLoginRedirect(['/panel'])).toBeUndefined();
    expect(sanitizeLoginRedirect('')).toBeUndefined();
    expect(sanitizeLoginRedirect('/sesion/inicio')).toBeUndefined();
    expect(sanitizeLoginRedirect('panel/productos')).toBeUndefined(); // relative — not rooted
    expect(sanitizeLoginRedirect('/paneling')).toBeUndefined(); // prefix must be a whole segment
  });

  it('rejects every open-redirect shape (the param is user-forgeable)', () => {
    expect(sanitizeLoginRedirect('https://evil.com/panel')).toBeUndefined();
    expect(sanitizeLoginRedirect('//evil.com/panel')).toBeUndefined();
    expect(sanitizeLoginRedirect('\\/panel')).toBeUndefined();
    expect(sanitizeLoginRedirect('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeLoginRedirect('/panel/../sesion/inicio')).toBeUndefined();
    expect(sanitizeLoginRedirect('/panel/..%2f..')).toBeUndefined();
  });
});
