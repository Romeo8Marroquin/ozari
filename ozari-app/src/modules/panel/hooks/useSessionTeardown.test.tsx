import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { closeAllModals } = vi.hoisted(() => ({ closeAllModals: vi.fn() }));
vi.mock('@components/modalRegistry', () => ({ closeAllModals }));

const { warning } = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { warning } }));

const { clearAuthState } = vi.hoisted(() => ({ clearAuthState: vi.fn() }));
vi.mock('@utils/tokenRefresh', () => ({ clearAuthState }));

const { resetForcedLogout } = vi.hoisted(() => ({ resetForcedLogout: vi.fn() }));
vi.mock('@utils/sessionLifecycle', () => ({
  resetForcedLogout,
  // `ForcedLogoutReason` is a type-only export; runtime module just needs the fns.
}));

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

import { PanelExitContext } from '../PanelExitContext';
import { useSessionTeardown } from './useSessionTeardown';

const runPanelExit = vi.fn().mockResolvedValue(undefined);
let client: QueryClient;
let clearSpy: ReturnType<typeof vi.spyOn>;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <PanelExitContext.Provider value={runPanelExit}>{children}</PanelExitContext.Provider>
  </QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
  clearSpy = vi.spyOn(client, 'clear');
});

describe('useSessionTeardown', () => {
  it('runs the full choreography in order for a manual sign-out', async () => {
    const { result } = renderHook(() => useSessionTeardown(), { wrapper });
    await act(async () => {
      await result.current('user');
    });

    expect(closeAllModals).toHaveBeenCalled();
    expect(clearAuthState).toHaveBeenCalled(); // token dropped BEFORE navigating
    expect(runPanelExit).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: '/sesion/inicio' });
    expect(clearSpy).toHaveBeenCalled(); // query cache cleared AFTER navigating
    expect(resetForcedLogout).toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled(); // no "session expired" toast for a manual logout
  });

  it('fires the "session expired" notice for a forced (expired) teardown', async () => {
    const { result } = renderHook(() => useSessionTeardown(), { wrapper });
    await act(async () => {
      await result.current('expired');
    });
    expect(warning).toHaveBeenCalledWith('errors.sessionExpired');
  });
});
