import { createFileRoute, redirect } from '@tanstack/react-router';
import { getStoredRole } from '@hooks/useRole';
import { panelHomeFor, PREFERENCES_ROLES } from '../../modules/panel/navConfig';
import PreferencesPage from '../../modules/panel/preferences/PreferencesPage';
import { parsePreferencesSearch } from '../../modules/panel/preferences/preferencesSearch';

export const Route = createFileRoute('/panel/preferencias')({
  // `?grupo=` keeps the open group across a reload / bookmark / shared link. Clamp-never-reject: an
  // unknown value resolves to the default group rather than erroring the route.
  validateSearch: parsePreferencesSearch,
  // Admin-only screen: any other role is bounced BEFORE it loads, to THEIR OWN panel home
  // (`panelHomeFor` — products for a Client, the agenda for a Driver) rather than a dead end or a
  // "no permission" screen. The sidebar tab is hidden for them by the same `PREFERENCES_ROLES`
  // source, so this guard only fires on a typed or bookmarked URL. The backend's Admin-only
  // `/api/preferences` routes remain the real security boundary. Unauthenticated visitors never get
  // here — the `/panel` parent guard redirects them to login first.
  beforeLoad: () => {
    const role = getStoredRole();
    if (role === null || !PREFERENCES_ROLES.includes(role)) {
      throw redirect({ to: panelHomeFor(role) });
    }
  },
  component: PreferencesPage,
});
