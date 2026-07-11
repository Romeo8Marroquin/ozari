import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StorageKeys } from '@constants/StorageKeys';
import { Role } from '@constants/Roles';
import { Storage } from '@utils/storage';
import RoleGate from './RoleGate';

const base64url = (obj: object): string =>
  btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const makeToken = (userRole: unknown): string =>
  `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ userId: 1, userRole })}.sig`;

beforeEach(() => sessionStorage.clear());
afterEach(() => sessionStorage.clear());

describe('RoleGate', () => {
  it('renders children when the role is allowed', () => {
    Storage.set(StorageKeys.TOKEN, makeToken(Role.Admin));
    render(
      <RoleGate roles={[Role.Admin]}>
        <span>secret</span>
      </RoleGate>,
    );
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('renders nothing by default when the role is not allowed', () => {
    Storage.set(StorageKeys.TOKEN, makeToken(Role.Client));
    render(
      <RoleGate roles={[Role.Admin]}>
        <span>secret</span>
      </RoleGate>,
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('renders the fallback when provided and the role is not allowed', () => {
    Storage.set(StorageKeys.TOKEN, makeToken(Role.Client));
    render(
      <RoleGate roles={[Role.Admin]} fallback={<span>nope</span>}>
        <span>secret</span>
      </RoleGate>,
    );
    expect(screen.getByText('nope')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });
});
