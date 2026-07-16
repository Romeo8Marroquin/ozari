import { createFileRoute, redirect } from '@tanstack/react-router';
import { getStoredRole } from '@hooks/useRole';
import { PRODUCTS_ROLES } from '../../modules/panel/navConfig';
import ProductDetailPage from '../../modules/panel/products/ProductDetailPage';

// `productos_.$productId` (note the underscore): a SIBLING of /panel/productos, not a child — the
// products list page renders no <Outlet>, so nesting would never paint this route. The sidebar
// still lights the Products tab for it via its `startsWith` matching.
export const Route = createFileRoute('/panel/productos_/$productId')({
  // Products are Admin + Client only (Epic-2A): a Driver is bounced to Settings — straight there,
  // not via /panel/productos, whose own guard would just chain a second redirect. A non-numeric id
  // can't be a product — bounce to the section root before anything loads (the clamp stance: a
  // hand-edited URL lands somewhere valid, never on a broken page). An unknown NUMERIC id is the
  // backend's call (404 → the page's not-found panel).
  beforeLoad: ({ params }) => {
    const role = getStoredRole();
    if (role === null || !PRODUCTS_ROLES.includes(role)) {
      throw redirect({ to: '/panel/ajustes' });
    }
    const id = Number(params.productId);
    if (!Number.isInteger(id) || id < 1) {
      throw redirect({ to: '/panel/productos' });
    }
  },
  component: ProductDetailPage,
});
