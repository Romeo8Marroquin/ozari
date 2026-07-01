import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './index.css';
import { routeTree } from './routeTree.gen';
import { createRouter, Navigate, RouterProvider } from '@tanstack/react-router';
import PageLoader from '@components/PageLoader';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initializeTokenRefresh } from '@utils/tokenRefresh';

export const router = createRouter({
  routeTree,
  defaultViewTransition: true,
  // Preload a route's chunk on hover/focus so the target is ready by the time it's clicked. This
  // keeps the panel's body transition seamless — the code-split screen is already loaded, so the
  // route commits instantly at the hidden midpoint of the fade instead of stalling on a chunk fetch.
  defaultPreload: 'intent',
  defaultNotFoundComponent: () => <Navigate to="/sesion/inicio" replace />,
  defaultPendingComponent: () => <PageLoader />,
});

export const queryClient = new QueryClient();

// Initialize token refresh system (proactive timer + 401 interceptor)
initializeTokenRefresh();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
