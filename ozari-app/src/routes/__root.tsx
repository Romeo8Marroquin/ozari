import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import NotificationHost from '@components/notifications/NotificationHost';
import DebugOverlay from '@components/DebugOverlay';

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <NotificationHost />
      <DebugOverlay />
      <TanStackRouterDevtools />
    </>
  ),
});
