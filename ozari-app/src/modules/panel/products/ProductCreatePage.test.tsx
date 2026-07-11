import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// RoleGate reads the current role through this hook — drive it directly.
const { useHasRole } = vi.hoisted(() => ({ useHasRole: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useHasRole }));

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
  useHasRole.mockReturnValue(true); // default: admin
});

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

  it('shows the friendly no-permission panel (with a way back) to a non-admin deep-link', async () => {
    useHasRole.mockReturnValue(false);
    const { navigate } = renderPage();

    expect(screen.queryByTestId('product-form')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: `${KEY}.noAccess.title` })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.noAccess.back` }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('registers a motion pair whose exit resolves and whose enter replays the reveal', async () => {
    const { registeredMotion } = renderPage();
    // Reduced motion (the global setup) short-circuits both: the exit resolves, the enter snaps.
    await expect(registeredMotion()!.exit()).resolves.toBeUndefined();
    expect(() => registeredMotion()!.enter({ fromCurrent: true })).not.toThrow();
  });
});
