import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get: apiGet } }));

import { hasReadableTerms, useTerms } from './useTerms';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('useTerms', () => {
  it('reads the terms as a PUBLIC request that never toasts on failure', async () => {
    apiGet.mockResolvedValue({ data: { data: { terms: 'Condiciones' } } });
    const { result } = renderHook(() => useTerms(), { wrapper });

    await waitFor(() => expect(result.current.data).toBe('Condiciones'));
    // `public` keeps the request from carrying (or refreshing) a session the visitor does not have;
    // `skipErrorNotification` keeps a failure invisible, because the register form works without it
    // and a toast about a document nobody asked for is pure noise.
    expect(apiGet).toHaveBeenCalledWith('/legal/terms', {
      public: true,
      skipErrorNotification: true,
    });
  });

  it('treats a missing envelope as no terms rather than as an error', async () => {
    apiGet.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useTerms(), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(''));
  });
});

describe('hasReadableTerms', () => {
  it('is true only when there is genuinely something to read', () => {
    expect(hasReadableTerms('Condiciones')).toBe(true);
    // Empty, whitespace-only, and not-yet-loaded all mean "offer nothing": a link that opens an
    // empty dialog reads as the app being broken rather than as the business having no terms.
    expect(hasReadableTerms('')).toBe(false);
    expect(hasReadableTerms('  \n ')).toBe(false);
    expect(hasReadableTerms(undefined)).toBe(false);
  });
});
