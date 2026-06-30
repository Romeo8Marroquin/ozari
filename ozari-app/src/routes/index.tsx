import { createFileRoute, redirect } from '@tanstack/react-router';

// No marketing landing for the admin MVP: the root always sends users to login.
// (The `/sesion` guard then forwards already-authenticated users on to the panel.)
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/sesion/inicio', replace: true });
  },
});
