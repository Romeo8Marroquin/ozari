import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';

/**
 * A fresh `QueryClientProvider` wrapper for `renderHook`/`render`, with retries off so failed
 * queries/mutations settle immediately (deterministic tests, no backoff waits).
 */
export function createQueryWrapper(): ({ children }: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
