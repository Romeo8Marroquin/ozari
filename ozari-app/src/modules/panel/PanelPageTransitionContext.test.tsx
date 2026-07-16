import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelPageTransitionContext, usePanelPageMotion, type PanelPageMotion } from './PanelPageTransitionContext';

describe('usePanelPageMotion', () => {
  it('registers on mount, forwards the latest motion pair, and clears on unmount', () => {
    const register = vi.fn();
    const enter = vi.fn();
    const exit = vi.fn().mockResolvedValue(undefined);

    const Page: React.FC = () => {
      usePanelPageMotion({ enter, exit });
      return null;
    };

    const { unmount } = render(
      <PanelPageTransitionContext.Provider value={register}>
        <Page />
      </PanelPageTransitionContext.Provider>,
    );

    expect(register).toHaveBeenCalledTimes(1);
    // The registered wrapper delegates to the current motion pair.
    const registered = register.mock.calls[0][0] as PanelPageMotion;
    registered.enter({ fromCurrent: true });
    expect(enter).toHaveBeenCalledWith({ fromCurrent: true });
    void registered.exit();
    expect(exit).toHaveBeenCalledTimes(1);

    unmount();
    expect(register).toHaveBeenLastCalledWith(null);
  });

  it('is a harmless no-op without a provider (default register)', () => {
    const Page: React.FC = () => {
      usePanelPageMotion({ enter: vi.fn(), exit: vi.fn() });
      return null;
    };
    expect(() => render(<Page />)).not.toThrow();
  });
});
