import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@api/client', () => ({ api: { get: apiGet } }));

import { useRegistrationStatus } from './useRegistrationStatus';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('useRegistrationStatus', () => {
  it('asks the API as a PUBLIC request that never toasts on failure', async () => {
    apiGet.mockResolvedValue({ data: { data: { open: true } } });
    const { result } = renderHook(() => useRegistrationStatus(), { wrapper });

    await waitFor(() => expect(result.current.data).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/auth/registration', {
      public: true,
      skipErrorNotification: true,
    });
  });

  it('reports a closed environment as closed', async () => {
    apiGet.mockResolvedValue({ data: { data: { open: false } } });
    const { result } = renderHook(() => useRegistrationStatus(), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(false));
  });

  it('treats a missing envelope as CLOSED — registration is offered only on a confirmed yes', async () => {
    apiGet.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useRegistrationStatus(), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(false));
  });
});
