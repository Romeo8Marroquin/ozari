import { StorageKeys } from '@constants/StorageKeys';
import { Role } from '@constants/Roles';
import { Storage } from '@utils/storage';
import { decodeToken } from '@utils/jwt';

/**
 * Role helpers for the client. The role drives **what's visible** (nav tabs, action buttons,
 * empty-state CTAs) — a UX layer, NOT the security boundary. The backend `403` is the real guard.
 *
 * The current role is read from the **decoded access token** (`userRole`) for an instant answer with
 * no round-trip — the token carries no PII, only `userId`/`userRole`. The verified profile
 * (`useMe` → `GET /auth/me`) is the source for the display name and can be used when the freshest
 * server-confirmed role matters; for gating UI, the token role is enough (and the backend re-verifies).
 */

/** The current user's role from the stored access token, or `null` when signed out / unreadable. */
export function getStoredRole(): Role | null {
  const token = Storage.get<string>(StorageKeys.TOKEN);
  if (!token) return null;
  const role = decodeToken(token)?.userRole;
  return typeof role === 'number' ? (role as Role) : null;
}

/** The current user's id from the stored access token, or `null` when signed out / unreadable — used
 *  to default the order form's "Asignar a" to the creating admin (the token carries `userId`). */
export function getStoredUserId(): number | null {
  const token = Storage.get<string>(StorageKeys.TOKEN);
  if (!token) return null;
  const userId = decodeToken(token)?.userId;
  return typeof userId === 'number' ? userId : null;
}

/** The current user's role (from the token). Recomputed each render; the token is stable per session. */
export function useRole(): Role | null {
  return getStoredRole();
}

/** Whether the current user holds one of `roles`. Use to conditionally render role-gated UI. */
export function useHasRole(roles: readonly Role[]): boolean {
  const role = useRole();
  return role !== null && roles.includes(role);
}
