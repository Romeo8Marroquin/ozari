import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { StorageKeys } from '@constants/StorageKeys';
import { Role } from '@constants/Roles';
import { Storage } from '@utils/storage';
import { getStoredRole, getStoredUserId, useHasRole, useRole } from './useRole';

const base64url = (obj: object): string =>
  btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/** A syntactically valid (unsigned) JWT carrying the given payload. */
const makeToken = (payload: Record<string, unknown>): string =>
  `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.sig`;

const setRole = (userRole: unknown): void =>
  Storage.set(StorageKeys.TOKEN, makeToken({ userId: 1, userRole }));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => sessionStorage.clear());

describe('getStoredRole', () => {
  it('returns the numeric role from the stored token', () => {
    setRole(Role.Admin);
    expect(getStoredRole()).toBe(Role.Admin);
  });

  it('returns null when there is no token', () => {
    expect(getStoredRole()).toBeNull();
  });

  it('returns null when the token has no numeric role', () => {
    setRole('Admin'); // a non-numeric role is not trusted
    expect(getStoredRole()).toBeNull();
  });

  it('returns null for a malformed (undecodable) token', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Storage.set(StorageKeys.TOKEN, 'not-a-jwt');
    expect(getStoredRole()).toBeNull();
  });
});

describe('getStoredUserId', () => {
  it('returns the numeric userId from the stored token', () => {
    Storage.set(StorageKeys.TOKEN, makeToken({ userId: 7, userRole: Role.Admin }));
    expect(getStoredUserId()).toBe(7);
  });

  it('returns null when there is no token', () => {
    expect(getStoredUserId()).toBeNull();
  });

  it('returns null when the token has no numeric userId', () => {
    Storage.set(StorageKeys.TOKEN, makeToken({ userId: 'x', userRole: Role.Admin }));
    expect(getStoredUserId()).toBeNull();
  });
});

describe('useRole', () => {
  it('exposes the current role', () => {
    setRole(Role.Driver);
    const { result } = renderHook(() => useRole());
    expect(result.current).toBe(Role.Driver);
  });
});

describe('useHasRole', () => {
  it('is true only when the current role is in the allowed set', () => {
    setRole(Role.Driver);
    expect(renderHook(() => useHasRole([Role.Admin])).result.current).toBe(false);
    expect(renderHook(() => useHasRole([Role.Admin, Role.Driver])).result.current).toBe(true);
  });

  it('is false when signed out', () => {
    expect(renderHook(() => useHasRole([Role.Admin])).result.current).toBe(false);
  });
});
