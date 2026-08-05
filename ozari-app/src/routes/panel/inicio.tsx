import { createFileRoute, redirect } from '@tanstack/react-router';
import { getStoredRole } from '@hooks/useRole';
import { DASHBOARD_ROLES, panelHomeFor } from '../../modules/panel/navConfig';
import DashboardPage from '../../modules/panel/dashboard/DashboardPage';

export const Route = createFileRoute('/panel/inicio')({
  // Admin-only screen: any other role is bounced BEFORE it loads, to THEIR OWN panel home
  // (`panelHomeFor` — products for a Client, the agenda for a Driver) rather than a dead end. The
  // sidebar tab is hidden for them by the same `DASHBOARD_ROLES` source, so this guard only fires on
  // a typed or bookmarked URL; the backend's Admin-only `/api/dashboard` route is the real boundary.
  //
  // This is also the ROLE-SPLIT boundary: a driver's or client's home is a different question about
  // different data and will get its own route + its own lazy chunk, so a non-admin never downloads
  // this screen's code. Not a runtime branch inside one shared component.
  beforeLoad: () => {
    const role = getStoredRole();
    if (role === null || !DASHBOARD_ROLES.includes(role)) {
      throw redirect({ to: panelHomeFor(role) });
    }
  },
  component: DashboardPage,
});
