import { createFileRoute, redirect } from '@tanstack/react-router';
import { Role } from '@constants/Roles';
import { getStoredRole } from '@hooks/useRole';
import ProductEditPage from '../../modules/panel/products/ProductEditPage';

// `productos_.$productId_.editar` (note BOTH underscores): a standalone sibling — neither the
// products list nor the product detail render an <Outlet>, so nesting would never paint this
// route. The sidebar still lights the Products tab for it via its `startsWith` matching.
export const Route = createFileRoute('/panel/productos_/$productId_/editar')({
  // Admin-only page: any other role (and any malformed id) is bounced BEFORE the page loads — no
  // "no permission" screen, the navigation simply lands on the section root (the closest sensible
  // parent). This is the UX gate; the backend 403 on PUT /products/:id remains the real security
  // boundary. Unauthenticated visitors never reach this check (the /panel parent guard redirects
  // them to login first). An unknown NUMERIC id is the backend's call (404 → the not-found panel).
  beforeLoad: ({ params }) => {
    const id = Number(params.productId);
    if (!Number.isInteger(id) || id < 1 || getStoredRole() !== Role.Admin) {
      throw redirect({ to: '/panel/productos' });
    }
  },
  component: ProductEditPage,
});
