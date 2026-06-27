import { createFileRoute, redirect } from '@tanstack/react-router';

// Any unmatched top-level path (e.g. /foo, /login/whatever) → login.
export const Route = createFileRoute('/$')({
  beforeLoad: () => {
    throw redirect({ to: '/sesion/inicio', replace: true });
  },
});
