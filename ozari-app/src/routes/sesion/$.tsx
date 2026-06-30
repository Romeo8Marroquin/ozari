import { createFileRoute, redirect } from '@tanstack/react-router';

// Any unmatched /sesion/* path → login.
export const Route = createFileRoute('/sesion/$')({
  beforeLoad: () => {
    throw redirect({ to: '/sesion/inicio', replace: true });
  },
});
