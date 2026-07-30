import { createFileRoute, redirect } from '@tanstack/react-router';
import { Role } from '@constants/Roles';
import { getStoredRole } from '@hooks/useRole';
import OrderEditPage from '../../modules/panel/orders/OrderEditPage';

// `pedidos_.$orderId_.editar` (note BOTH underscores): a standalone sibling — neither the orders
// list nor the order detail renders an <Outlet>, so nesting would never paint this route. The
// sidebar still lights the Orders tab for it via its `startsWith` matching.
export const Route = createFileRoute('/panel/pedidos_/$orderId_/editar')({
  // Admin-only page: any other role (a Driver reports what happened through the lifecycle; they
  // never rewrite what was agreed) and any malformed id are bounced BEFORE the page loads — no "no
  // permission" screen, the navigation simply lands on the section root. The backend 403 on
  // PUT /orders/:id remains the real security boundary. An unknown NUMERIC id is the backend's call
  // (404 → the not-found panel).
  beforeLoad: ({ params }) => {
    const id = Number(params.orderId);
    if (!Number.isInteger(id) || id < 1 || getStoredRole() !== Role.Admin) {
      throw redirect({ to: '/panel/pedidos' });
    }
  },
  component: OrderEditPage,
});
