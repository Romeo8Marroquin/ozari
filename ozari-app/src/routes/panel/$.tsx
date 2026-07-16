import { createFileRoute, redirect } from '@tanstack/react-router';
import { PANEL_NAV } from '../../modules/panel/navConfig';

// Any unmatched path under /panel lands on the CLOSEST known root, never on a broken page and
// never on a "not allowed" screen: /panel/productos/<anything unknown or not permitted> →
// /panel/productos (the section root — deliberately NOT the panel default, which may become a
// dashboard later), and an unknown section → /panel (whose index owns the default redirect).
// This is the clamp stance the product routes already take, generalized to the whole panel.
export const Route = createFileRoute('/panel/$')({
  beforeLoad: ({ params }) => {
    const section = (params._splat ?? '').split('/')[0];
    const sectionRoot = PANEL_NAV.find((item) => item.to === `/panel/${section}`)?.to;
    if (sectionRoot) {
      throw redirect({ to: sectionRoot, replace: true });
    }
    throw redirect({ to: '/panel', replace: true });
  },
});
