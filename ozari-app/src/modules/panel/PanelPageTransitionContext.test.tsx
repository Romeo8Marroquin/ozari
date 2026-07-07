import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelPageTransitionContext, usePanelPageExit } from './PanelPageTransitionContext';

describe('usePanelPageExit', () => {
  it('registers on mount, forwards the latest exit, and clears on unmount', () => {
    const register = vi.fn();
    const exit = vi.fn().mockResolvedValue(undefined);

    const Page: React.FC = () => {
      usePanelPageExit(exit);
      return null;
    };

    const { unmount } = render(
      <PanelPageTransitionContext.Provider value={register}>
        <Page />
      </PanelPageTransitionContext.Provider>,
    );

    expect(register).toHaveBeenCalledTimes(1);
    // The registered wrapper delegates to the current exit function.
    const registered = register.mock.calls[0][0] as () => Promise<void>;
    void registered();
    expect(exit).toHaveBeenCalledTimes(1);

    unmount();
    expect(register).toHaveBeenLastCalledWith(null);
  });

  it('is a harmless no-op without a provider (default register)', () => {
    const Page: React.FC = () => {
      usePanelPageExit(vi.fn());
      return null;
    };
    expect(() => render(<Page />)).not.toThrow();
  });
});
