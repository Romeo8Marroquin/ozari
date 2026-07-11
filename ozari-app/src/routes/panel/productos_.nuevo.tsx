import { createFileRoute } from '@tanstack/react-router';
import ProductCreatePage from '../../modules/panel/products/ProductCreatePage';

// `productos_.nuevo` (note the underscore): a SIBLING of /panel/productos, not a child — the
// products list page renders no <Outlet>, so nesting would never paint this route. The sidebar
// still lights the Products tab for it via its `startsWith` matching.
export const Route = createFileRoute('/panel/productos_/nuevo')({
  component: ProductCreatePage,
});
