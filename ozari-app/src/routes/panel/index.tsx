import { createFileRoute, redirect } from '@tanstack/react-router';

// The panel has no dashboard yet, so bare `/panel` lands on the products catalog — the first built
// module and the default staff view. (The `/panel` parent guard authenticates first.)
export const Route = createFileRoute('/panel/')({
  beforeLoad: () => {
    throw redirect({ to: '/panel/productos', replace: true });
  },
});
