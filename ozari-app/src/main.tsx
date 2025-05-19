import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './index.css';
import { routeTree } from './routeTree.gen';
import { createRouter, Navigate, RouterProvider } from '@tanstack/react-router';
import PageLoader from '@components/PageLoader';

const router = createRouter({
  routeTree,
  defaultNotFoundComponent: () => <Navigate to="/" />,
  defaultPendingComponent: () => <PageLoader />,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
