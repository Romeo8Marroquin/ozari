import type { ReactNode } from 'react';
import type { Role } from '@constants/Roles';
import { useHasRole } from '@hooks/useRole';

interface RoleGateProps {
  /** The roles allowed to see `children`. */
  roles: readonly Role[];
  children: ReactNode;
  /** Rendered instead when the current role isn't allowed (default: nothing). */
  fallback?: ReactNode;
}

/**
 * Conditionally renders UI by role — the declarative form of `useHasRole`. Used to hide controls a
 * role can't use (e.g. admin-only "Agregar producto") so the call never fires. This is a **UX layer,
 * not the security boundary**: the backend `403` is the real guard, so hiding here is about a clean,
 * graceful experience, not access control.
 */
const RoleGate: React.FC<RoleGateProps> = ({ roles, children, fallback = null }) => {
  return useHasRole(roles) ? <>{children}</> : <>{fallback}</>;
};

export default RoleGate;
