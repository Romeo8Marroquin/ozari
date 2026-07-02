import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeToken,
  getTokenExpiration,
  getTokenTimeRemaining,
  isTokenExpired,
  isTokenValid,
} from './jwt';

const base64url = (obj: object): string =>
  btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/** A syntactically valid (unsigned) JWT with the given payload. */
const makeToken = (payload: Record<string, unknown>): string =>
  `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.sig`;

const NOW = 1_700_000_000; // fixed "now" in seconds

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

describe('decodeToken', () => {
  it('decodes the payload of a valid token', () => {
    const token = makeToken({ userId: '1', exp: NOW + 60 });
    expect(decodeToken(token)).toMatchObject({ userId: '1', exp: NOW + 60 });
  });

  it('returns null for a malformed token', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(decodeToken('not-a-jwt')).toBeNull();
  });
});

describe('isTokenExpired / isTokenValid', () => {
  it('a future-exp token is valid and not expired', () => {
    const token = makeToken({ exp: NOW + 60 });
    expect(isTokenExpired(token)).toBe(false);
    expect(isTokenValid(token)).toBe(true);
  });

  it('a past-exp token is expired and invalid', () => {
    const token = makeToken({ exp: NOW - 1 });
    expect(isTokenExpired(token)).toBe(true);
    expect(isTokenValid(token)).toBe(false);
  });

  it('treats a token with no exp claim as expired', () => {
    expect(isTokenExpired(makeToken({ userId: '1' }))).toBe(true);
  });

  it('isTokenValid is false for null/empty', () => {
    expect(isTokenValid(null)).toBe(false);
    expect(isTokenValid('')).toBe(false);
  });
});

describe('getTokenTimeRemaining', () => {
  it('returns whole seconds until expiry', () => {
    expect(getTokenTimeRemaining(makeToken({ exp: NOW + 900 }))).toBe(900);
  });

  it('returns 0 for an expired or exp-less token', () => {
    expect(getTokenTimeRemaining(makeToken({ exp: NOW - 5 }))).toBe(0);
    expect(getTokenTimeRemaining(makeToken({}))).toBe(0);
  });
});

describe('getTokenExpiration', () => {
  it('returns the expiry as a Date', () => {
    expect(getTokenExpiration(makeToken({ exp: NOW + 10 }))?.getTime()).toBe((NOW + 10) * 1000);
  });

  it('returns null without an exp claim', () => {
    expect(getTokenExpiration(makeToken({}))).toBeNull();
  });
});
