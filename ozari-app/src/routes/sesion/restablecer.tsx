import { StorageKeys } from '@constants/StorageKeys';
import ResetPasswordPage from '@sesion/login/ResetPasswordPage';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Storage } from '@utils/storage';
import { clearAuthState } from '@utils/tokenRefresh';

export const Route = createFileRoute('/sesion/restablecer')({
  // The reset token arrives as `?token=` on the emailed link.
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search['token'] === 'string' ? search['token'] : undefined,
  }),
  beforeLoad: ({ search }) => {
    // Not navigable without a token — bounce to login (which plays its own entrance animation).
    // (A logged-in user with NO token is already sent to the panel by the parent `/sesion` guard.)
    if (!search.token) throw redirect({ to: '/sesion/inicio' });
    // Arrived with a token while still authenticated: clear the local session so the reset runs
    // against a clean state. The backend revokes every session on completion anyway, and this public
    // flow ignores the access token — so keeping a half-logged-in state here would only confuse.
    if (Storage.get<string>(StorageKeys.TOKEN)) clearAuthState();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { token } = Route.useSearch();
  // `token` is guaranteed present by `beforeLoad`; narrow for TypeScript.
  return <ResetPasswordPage token={token ?? ''} />;
}
