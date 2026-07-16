import { createFileRoute } from '@tanstack/react-router';
import { parseProductListSearch } from '../../modules/panel/products/productListSearch';
import ProductsPage from '../../modules/panel/products/ProductsPage';

export const Route = createFileRoute('/panel/productos')({
  // Filters live in the URL (shareable/refresh-safe); the parser clamps or drops bad values, never
  // errors — a hand-edited URL always lands on a valid view.
  validateSearch: parseProductListSearch,
  component: ProductsPage,
});
