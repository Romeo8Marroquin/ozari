import { createFileRoute, redirect } from '@tanstack/react-router';
import { Role } from '@constants/Roles';
import { getStoredRole } from '@hooks/useRole';
import ProductArrangePage from '../../modules/panel/products/ProductArrangePage';

// `productos_.ordenar` (note the underscore): a SIBLING of /panel/productos, like `nuevo` — the list
// page renders no <Outlet>. A static segment, so it outranks the `$productId` detail route.
export const Route = createFileRoute('/panel/productos_/ordenar')({
  // Admin-only page: any other role is bounced BEFORE the page loads, landing on the section root.
  // The UX gate; the backend 403 on /products/display-order remains the real security boundary.
  beforeLoad: () => {
    if (getStoredRole() !== Role.Admin) {
      throw redirect({ to: '/panel/productos' });
    }
  },
  component: ProductArrangePage,
});
