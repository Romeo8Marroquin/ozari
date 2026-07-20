import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('../PanelNavContext', () => ({ usePanelNavigate: () => navigateTo }));

const { usePanelPageMotion } = vi.hoisted(() => ({ usePanelPageMotion: vi.fn() }));
vi.mock('../PanelPageTransitionContext', () => ({ usePanelPageMotion }));

const { staggerIn, staggerOut } = vi.hoisted(() => ({
  staggerIn: vi.fn(),
  staggerOut: vi.fn(() => Promise.resolve()),
}));
vi.mock('../pageMotion', () => ({ staggerIn, staggerOut }));

// The form has its own suite — stub it so the page test stays focused on the page chrome.
vi.mock('./OrderForm', () => ({ default: () => <div data-testid="order-form" /> }));

import OrderCreatePage from './OrderCreatePage';

const KEY = 'modules.panel.orders.create';

beforeEach(() => vi.clearAllMocks());

describe('OrderCreatePage', () => {
  it('renders the heading, back affordance, and the form; plays its mount entrance', () => {
    render(<OrderCreatePage />);
    expect(screen.getByText(`${KEY}.title`)).toBeInTheDocument();
    expect(screen.getByTestId('order-form')).toBeInTheDocument();
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.reveal-block');
  });

  it('the back button navigates to the agenda', async () => {
    render(<OrderCreatePage />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.back` }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos');
  });

  it('registers an enter/exit motion pair with the panel', async () => {
    render(<OrderCreatePage />);
    const motion = usePanelPageMotion.mock.calls[0]?.[0] as {
      enter: (o?: object) => void;
      exit: () => Promise<void>;
    };
    motion.enter({ fromCurrent: true });
    await motion.exit();
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.reveal-block', { fromCurrent: true });
    expect(staggerOut).toHaveBeenCalledWith(expect.anything(), '.reveal-block');
  });
});
