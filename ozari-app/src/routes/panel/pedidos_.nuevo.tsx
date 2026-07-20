import { createFileRoute, redirect } from '@tanstack/react-router';
import { Role } from '@constants/Roles';
import { getStoredRole } from '@hooks/useRole';
import OrderCreatePage from '../../modules/panel/orders/OrderCreatePage';

// `pedidos_.nuevo` (note the underscore): a SIBLING of /panel/pedidos, not a child — the agenda
// renders no <Outlet>, so nesting would never paint this route. The sidebar still lights the
// Pedidos tab for it via its `startsWith` matching.
export const Route = createFileRoute('/panel/pedidos_/nuevo')({
  // Admin-only page (only the admin creates orders — owner rule): any other role is bounced BEFORE
  // the page loads to the pedidos root (or, for a Driver/Client who can't see pedidos, the route
  // guard on /panel/pedidos will bounce them onward). The backend 403 on POST /orders is the real
  // boundary. Unauthenticated visitors never reach this check (the /panel parent guard redirects).
  beforeLoad: () => {
    if (getStoredRole() !== Role.Admin) {
      throw redirect({ to: '/panel/pedidos' });
    }
  },
  component: OrderCreatePage,
});
