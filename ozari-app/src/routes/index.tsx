import { createFileRoute, Navigate } from '@tanstack/react-router';
import LandingPage from '../modules/landing/LandingPage';

export const Route = createFileRoute('/')({
  component: LandingPage,
  notFoundComponent: () => <Navigate to="/" />,
});
