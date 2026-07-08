import ResetPasswordPage from '@sesion/login/ResetPasswordPage';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/sesion/restablecer')({
  // The reset token arrives as `?token=` on the emailed link.
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search['token'] === 'string' ? search['token'] : undefined,
  }),
  // Not navigable without a token — bounce to login (which plays its own entrance animation).
  beforeLoad: ({ search }) => {
    if (!search.token) throw redirect({ to: '/sesion/inicio' });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { token } = Route.useSearch();
  // `token` is guaranteed present by `beforeLoad`; narrow for TypeScript.
  return <ResetPasswordPage token={token ?? ''} />;
}
