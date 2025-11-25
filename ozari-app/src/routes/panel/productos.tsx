import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/panel/productos')({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/panel/productos"!</div>;
}
