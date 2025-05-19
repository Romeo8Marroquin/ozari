import LoginPage from '@sesion/login/LoginPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/sesion/inicio')({
  component: LoginPage,
});
