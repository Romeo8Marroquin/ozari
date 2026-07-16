import { AxiosError } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getRetryAfterSeconds,
  getServerMessage,
  getStatus,
  isAuthFailure,
  isInlineFormError,
  isNetworkError,
  isOutageStatus,
  isTransientStatus,
  resolveApiErrorMessage,
  toFormError,
} from './apiError';

/** Build an AxiosError with an optional HTTP response (omit `status` for a network error). */
function axiosError(
  status?: number,
  data?: unknown,
  headers: Record<string, string> = {},
): AxiosError {
  const response =
    status === undefined
      ? undefined
      : ({ status, data, headers, statusText: '', config: {} } as never);
  return new AxiosError('boom', 'ECODE', undefined, undefined, response);
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

afterEach(() => setOnline(true));

describe('getStatus / isNetworkError', () => {
  it('reads the response status when present', () => {
    expect(getStatus(axiosError(404))).toBe(404);
    expect(isNetworkError(axiosError(404))).toBe(false);
  });

  it('is a network error (no status) when there is no response', () => {
    expect(getStatus(axiosError())).toBeUndefined();
    expect(isNetworkError(axiosError())).toBe(true);
  });
});

describe('status classifiers', () => {
  it('isTransientStatus: network/429/5xx are transient, deterministic 4xx are not', () => {
    expect(isTransientStatus(undefined)).toBe(true);
    expect(isTransientStatus(429)).toBe(true);
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
    expect(isTransientStatus(400)).toBe(false);
    expect(isTransientStatus(401)).toBe(false);
    expect(isTransientStatus(200)).toBe(false);
  });

  it('isAuthFailure: only 401/403', () => {
    expect(isAuthFailure(401)).toBe(true);
    expect(isAuthFailure(403)).toBe(true);
    expect(isAuthFailure(400)).toBe(false);
    expect(isAuthFailure(undefined)).toBe(false);
  });

  it('isOutageStatus: only gateway/unavailable 502/503/504', () => {
    expect(isOutageStatus(502)).toBe(true);
    expect(isOutageStatus(503)).toBe(true);
    expect(isOutageStatus(504)).toBe(true);
    expect(isOutageStatus(500)).toBe(false);
    expect(isOutageStatus(429)).toBe(false);
    expect(isOutageStatus(undefined)).toBe(false);
  });

  it('isInlineFormError: the input-related 4xx a form owns', () => {
    for (const s of [400, 401, 409, 422]) expect(isInlineFormError(s)).toBe(true);
    for (const s of [403, 429, 500, undefined]) expect(isInlineFormError(s)).toBe(false);
  });
});

describe('getServerMessage', () => {
  it('returns a trimmed, non-empty body message', () => {
    expect(getServerMessage(axiosError(400, { message: 'Correo ya existe' }))).toBe('Correo ya existe');
  });

  it('ignores empty/whitespace/missing messages and network errors', () => {
    expect(getServerMessage(axiosError(400, { message: '   ' }))).toBeUndefined();
    expect(getServerMessage(axiosError(400, {}))).toBeUndefined();
    expect(getServerMessage(axiosError(400, { message: 123 }))).toBeUndefined();
    expect(getServerMessage(axiosError())).toBeUndefined();
  });
});

describe('getRetryAfterSeconds', () => {
  it('parses a plain-seconds Retry-After, rounding up', () => {
    expect(getRetryAfterSeconds(axiosError(429, {}, { 'retry-after': '5' }))).toBe(5);
    expect(getRetryAfterSeconds(axiosError(429, {}, { 'retry-after': '2.3' }))).toBe(3);
  });

  it('ignores non-positive, non-numeric, or missing values', () => {
    expect(getRetryAfterSeconds(axiosError(429, {}, { 'retry-after': '0' }))).toBeUndefined();
    expect(getRetryAfterSeconds(axiosError(429, {}, { 'retry-after': 'Wed, 21 Oct' }))).toBeUndefined();
    expect(getRetryAfterSeconds(axiosError(429))).toBeUndefined();
    expect(getRetryAfterSeconds(axiosError())).toBeUndefined();
  });
});

describe('resolveApiErrorMessage', () => {
  it('network error: offline vs generic-network by connectivity', () => {
    setOnline(true);
    expect(resolveApiErrorMessage(axiosError())).toBe('errors.network');
    setOnline(false);
    expect(resolveApiErrorMessage(axiosError())).toBe('errors.offline');
  });

  it('429/503 with Retry-After becomes a countdown key', () => {
    expect(resolveApiErrorMessage(axiosError(429, {}, { 'retry-after': '5' }))).toBe(
      'errors.tooManyRequestsWait',
    );
    expect(resolveApiErrorMessage(axiosError(503, {}, { 'retry-after': '5' }))).toBe(
      'errors.tooManyRequestsWait',
    );
  });

  it('prefers a server-provided message over generic copy', () => {
    expect(resolveApiErrorMessage(axiosError(400, { message: 'Datos inválidos' }))).toBe('Datos inválidos');
  });

  it('falls back to status-specific keys with no server message', () => {
    expect(resolveApiErrorMessage(axiosError(503))).toBe('errors.maintenance');
    expect(resolveApiErrorMessage(axiosError(429))).toBe('errors.tooManyRequests');
    expect(resolveApiErrorMessage(axiosError(500))).toBe('errors.server');
    expect(resolveApiErrorMessage(axiosError(403))).toBe('errors.forbidden');
    expect(resolveApiErrorMessage(axiosError(401))).toBe('errors.unauthorized');
    expect(resolveApiErrorMessage(axiosError(418))).toBe('errors.generic');
  });
});

describe('toFormError', () => {
  it('non-axios errors become a generic toast', () => {
    expect(toFormError(new Error('nope'), 'fallback')).toEqual({ toast: 'errors.generic' });
  });

  it('outage statuses are handed to the overlay (nothing inline, nothing toasted)', () => {
    expect(toFormError(axiosError(503), 'fallback')).toEqual({});
  });

  it('inline statuses use the server message, else the fallback', () => {
    expect(toFormError(axiosError(401, { message: 'Credenciales inválidas' }), 'fb')).toEqual({
      inline: 'Credenciales inválidas',
    });
    expect(toFormError(axiosError(409), 'fb')).toEqual({ inline: 'fb' });
  });

  it('everything else (5xx/network/429) becomes a toast', () => {
    expect(toFormError(axiosError(500), 'fb')).toEqual({ toast: 'errors.server' });
    setOnline(true);
    expect(toFormError(axiosError(), 'fb')).toEqual({ toast: 'errors.network' });
  });
});
