import SesionLayout from '@sesion/SesionLayout';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/sesion')({
  component: SesionLayout,
});
