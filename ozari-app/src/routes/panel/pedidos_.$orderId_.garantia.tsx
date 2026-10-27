import { createFileRoute, redirect } from '@tanstack/react-router';
import { Role } from '@constants/Roles';
import { getStoredRole } from '@hooks/useRole';
import OrderSettlementPage from '../../modules/panel/orders/OrderSettlementPage';

// `pedidos_.$orderId_.garantia` (note BOTH underscores): a standalone sibling like `editar` — neither
// the orders list nor the order detail renders an <Outlet>. The sidebar still lights the Orders tab.
export const Route = createFileRoute('/panel/pedidos_/$orderId_/garantia')({
  // Admin-only page (recording what happens to a client's deposit is the admin's call, like the
  // payment): any other role and any malformed id are bounced BEFORE the page loads. The backend 403
  // on PUT /orders/:id/settlement remains the real boundary; an unknown NUMERIC id is the backend's
  // call (404 → the not-found panel).
  beforeLoad: ({ params }) => {
    const id = Number(params.orderId);
    if (!Number.isInteger(id) || id < 1 || getStoredRole() !== Role.Admin) {
      throw redirect({ to: '/panel/pedidos' });
    }
  },
  component: OrderSettlementPage,
});
