import { createFileRoute, redirect } from '@tanstack/react-router';
import { Role } from '@constants/Roles';
import { getStoredRole } from '@hooks/useRole';
import ProductCreatePage from '../../modules/panel/products/ProductCreatePage';

// `productos_.nuevo` (note the underscore): a SIBLING of /panel/productos, not a child — the
// products list page renders no <Outlet>, so nesting would never paint this route. The sidebar
// still lights the Products tab for it via its `startsWith` matching.
export const Route = createFileRoute('/panel/productos_/nuevo')({
  // Admin-only page: any other role is bounced BEFORE the page loads — no "no permission" screen,
  // the navigation simply lands on the section root (the closest sensible parent). This is the UX
  // gate; the backend 403 on POST /products remains the real security boundary. Unauthenticated
  // visitors never reach this check (the /panel parent guard redirects them to login first).
  beforeLoad: () => {
    if (getStoredRole() !== Role.Admin) {
      throw redirect({ to: '/panel/productos' });
    }
  },
  component: ProductCreatePage,
});
