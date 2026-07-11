import { createFileRoute } from '@tanstack/react-router';
import ProductsPage from '../../modules/panel/products/ProductsPage';

export const Route = createFileRoute('/panel/productos')({
  component: ProductsPage,
});
