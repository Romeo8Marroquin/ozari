import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/sesion/$')({
  component: () => <Navigate to="/sesion/inicio" />,
});
