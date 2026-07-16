import { createFileRoute, redirect } from '@tanstack/react-router';
import { getStoredRole } from '@hooks/useRole';
import { PRODUCTS_ROLES } from '../../modules/panel/navConfig';
import { parseProductListSearch } from '../../modules/panel/products/productListSearch';
import ProductsPage from '../../modules/panel/products/ProductsPage';

export const Route = createFileRoute('/panel/productos')({
  // Products are Admin + Client only (Epic-2A): a Driver — or any future unlisted role — is bounced
  // to Settings (their panel home) BEFORE the page loads, the same silent way `nuevo`/`editar`
  // bounce non-admins. This is the UX gate; the backend 403 on every /products read is the real
  // security boundary. Unauthenticated visitors never reach this check (the /panel parent guard
  // redirects them to login first).
  beforeLoad: () => {
    const role = getStoredRole();
    if (role === null || !PRODUCTS_ROLES.includes(role)) {
      throw redirect({ to: '/panel/ajustes' });
    }
  },
  // Filters live in the URL (shareable/refresh-safe); the parser clamps or drops bad values, never
  // errors — a hand-edited URL always lands on a valid view.
  validateSearch: parseProductListSearch,
  component: ProductsPage,
});
