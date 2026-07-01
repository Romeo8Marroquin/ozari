import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './index.css';
import { routeTree } from './routeTree.gen';
import axios from 'axios';
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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Auto-retry only TRANSIENT failures (network / 5xx). Client errors (4xx) are deterministic —
      // a retry won't fix a 400/403/404 — so fail fast and let the UI surface it. Cap at 2 retries
      // (3 attempts total), then stop: the query's error state offers a MANUAL retry, so we never
      // loop forever waiting on the machine when it should be the user's call.
      retry: (failureCount, error) => {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      // Short exponential backoff (~1s, ~2s) capped well below React Query's 30s default, so the
      // whole retry window is a few seconds — long enough to ride out a blip, short enough that the
      // user isn't left staring at a skeleton.
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    },
  },
});

// Initialize token refresh system (proactive timer + 401 interceptor)
initializeTokenRefresh();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
