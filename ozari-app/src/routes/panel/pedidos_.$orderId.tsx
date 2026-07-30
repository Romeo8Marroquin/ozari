import { createFileRoute, redirect } from '@tanstack/react-router';
import OrderDetailPage from '../../modules/panel/orders/OrderDetailPage';

// `pedidos_.$orderId` (note the underscore): a SIBLING of /panel/pedidos, not a child — the orders
// list renders no <Outlet>, so nesting would never paint this route. The sidebar still lights the
// Orders tab for it via its `startsWith` matching.
export const Route = createFileRoute('/panel/pedidos_/$orderId')({
  // The orders section is staff-only and already gated by the panel guard; the ROW-level rule (a
  // Driver may only open an order assigned to them) is the backend's — it answers the same 404 as a
  // missing order, so the page's not-found panel covers both without leaking that it exists.
  // A non-numeric id can't be an order: bounce to the section root before anything loads (the clamp
  // stance — a hand-edited URL lands somewhere valid, never on a broken page).
  beforeLoad: ({ params }) => {
    const id = Number(params.orderId);
    if (!Number.isInteger(id) || id < 1) {
      throw redirect({ to: '/panel/pedidos' });
    }
  },
  component: OrderDetailPage,
});
