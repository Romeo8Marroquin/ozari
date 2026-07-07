import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import NotificationHost from '@components/notifications/NotificationHost';
import AppOverlay from '@components/AppOverlay';

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <NotificationHost />
      <AppOverlay />
      <TanStackRouterDevtools />
    </>
  ),
});
