import RegisterPage from '@sesion/register/RegisterPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/sesion/registro')({
  component: RegisterPage,
});
