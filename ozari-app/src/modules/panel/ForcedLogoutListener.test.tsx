import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { setForcedLogoutHandler } = vi.hoisted(() => ({
  setForcedLogoutHandler: vi.fn((_handler: (r: string) => void) => vi.fn()),
}));
vi.mock('@utils/sessionLifecycle', () => ({ setForcedLogoutHandler }));

const { teardown } = vi.hoisted(() => ({ teardown: vi.fn() }));
vi.mock('./hooks/useSessionTeardown', () => ({ useSessionTeardown: () => teardown }));

import ForcedLogoutListener from './ForcedLogoutListener';

describe('ForcedLogoutListener', () => {
  it('registers the session teardown as the forced-logout handler', () => {
    render(<ForcedLogoutListener />);
    expect(setForcedLogoutHandler).toHaveBeenCalledTimes(1);

    // The registered handler delegates to the teardown with the reason.
    const handler = setForcedLogoutHandler.mock.calls[0][0];
    handler('expired');
    expect(teardown).toHaveBeenCalledWith('expired');
  });
});
