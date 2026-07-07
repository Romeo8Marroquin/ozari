import { useEffect } from 'react';
import { setForcedLogoutHandler } from '@utils/sessionLifecycle';
import { useSessionTeardown } from './hooks/useSessionTeardown';

/**
 * The single React consumer of the session-lifecycle bridge. Mounted once inside the panel (so it
 * has the panel-exit context), it registers the teardown as the handler the interceptor / refresh
 * timer reach when a session dies. Renders nothing — it's pure wiring.
 */
const ForcedLogoutListener: React.FC = () => {
  const teardown = useSessionTeardown();

  useEffect(() => setForcedLogoutHandler((reason) => teardown(reason)), [teardown]);

  return null;
};

export default ForcedLogoutListener;
