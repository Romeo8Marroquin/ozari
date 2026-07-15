import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The form is a heavy component with its own suite — a stub isolates the page shell.
vi.mock('./ProductForm', () => ({
  default: () => <div data-testid="product-form" />,
}));

import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import { PanelPageTransitionContext, type PanelPageMotion } from '../PanelPageTransitionContext';
import ProductCreatePage from './ProductCreatePage';

const KEY = 'modules.panel.products.create';

const renderPage = () => {
  let motion: PanelPageMotion | null = null;
  const register = (value: PanelPageMotion | null): void => {
    if (value) motion = value;
  };
  const navigate = vi.fn();
  const nav: PanelNav = { navigateTo: navigate, pending: null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PanelNavContext.Provider value={nav}>
      <PanelPageTransitionContext.Provider value={register}>{children}</PanelPageTransitionContext.Provider>
    </PanelNavContext.Provider>
  );
  const utils = render(<ProductCreatePage />, { wrapper });
  return { ...utils, navigate, registeredMotion: () => motion };
};

beforeEach(() => {
  vi.clearAllMocks();
});

// Access control is NOT this page's job anymore: the route's `beforeLoad` redirects non-admins
// before it ever mounts (routes are exercised e2e, not unit-tested) — so the page renders
// unconditionally here, and there is no in-page "no permission" state to cover.
describe('ProductCreatePage', () => {
  it('renders the heading, lead, and the form for an admin', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: `${KEY}.title` })).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.lead`)).toBeInTheDocument();
    expect(screen.getByTestId('product-form')).toBeInTheDocument();
  });

  it('navigates back to the catalog through the panel transition', async () => {
    const { navigate } = renderPage();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.back` }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('registers a motion pair whose exit resolves and whose enter replays the reveal', async () => {
    const { registeredMotion } = renderPage();
    // Reduced motion (the global setup) short-circuits both: the exit resolves, the enter snaps.
    await expect(registeredMotion()!.exit()).resolves.toBeUndefined();
    expect(() => registeredMotion()!.enter({ fromCurrent: true })).not.toThrow();
  });
});
