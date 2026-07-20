import { createFileRoute, redirect } from '@tanstack/react-router';
import { getStoredRole } from '@hooks/useRole';
import { ORDERS_ROLES, panelHomeFor } from '../../modules/panel/navConfig';
import { parseOrdersSearch } from '../../modules/panel/orders/ordersSearch';
import OrdersPage from '../../modules/panel/orders/OrdersPage';

export const Route = createFileRoute('/panel/pedidos')({
  // Orders are Admin-only while the backend reads are (Epic-2 step 2): any other role bounces to
  // its own panel home (a Client to products, a Driver to settings) — the same silent UX gate the
  // products routes use; the backend 403 is the real security boundary. Unauthenticated visitors
  // never reach this check (the /panel parent guard redirects them to login first).
  beforeLoad: () => {
    const role = getStoredRole();
    if (role === null || !ORDERS_ROLES.includes(role)) {
      // TanStack's typed `to` can't carry the PanelPath union (it includes resolved param paths).
      throw redirect({ to: panelHomeFor(role) as never });
    }
  },
  // The view lives in the URL (shareable/refresh-safe); the parser clamps bad values to the
  // default agenda, never errors.
  validateSearch: parseOrdersSearch,
  component: OrdersPage,
});
