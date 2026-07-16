import { createFileRoute, redirect } from '@tanstack/react-router';
import { getStoredRole } from '@hooks/useRole';
import { panelHomeFor } from '../../modules/panel/navConfig';

// The panel has no dashboard yet, so bare `/panel` lands on the role's FIRST visible tab —
// products for Admin/Client, settings for a Driver (who can't see products; Epic-2A). Derived from
// the same nav-visibility source as the sidebar (`panelHomeFor`), so the landing and the tabs can
// never disagree. (The `/panel` parent guard authenticates first.)
export const Route = createFileRoute('/panel/')({
  beforeLoad: () => {
    throw redirect({ to: panelHomeFor(getStoredRole()), replace: true });
  },
});
