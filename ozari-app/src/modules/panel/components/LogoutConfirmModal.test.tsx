import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The shared teardown the modal runs on a successful sign-out.
const { teardown } = vi.hoisted(() => ({ teardown: vi.fn() }));
vi.mock('../hooks/useSessionTeardown', () => ({ useSessionTeardown: () => teardown }));

// Mock the logout mutation so we can capture the `onLoggedOut` callback and control the pending state.
const { useLogout, logout } = vi.hoisted(() => ({ useLogout: vi.fn(), logout: vi.fn() }));
vi.mock('@hooks/useLogout', () => ({ useLogout }));

import LogoutConfirmModal from './LogoutConfirmModal';

beforeEach(() => {
  vi.clearAllMocks();
  useLogout.mockImplementation((onLoggedOut?: () => void) => {
    // Simulate a successful mutation: calling logout() invokes the success callback.
    logout.mockImplementation(() => onLoggedOut?.());
    return { logout, isPending: false };
  });
});
afterEach(() => vi.restoreAllMocks());

describe('LogoutConfirmModal', () => {
  it('renders the confirm dialog with cancel + confirm actions', () => {
    render(<LogoutConfirmModal open onClose={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'modules.panel.logout.cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'modules.panel.logout.confirm' })).toBeInTheDocument();
  });

  it('confirming signs out and then runs the shared session teardown', async () => {
    render(<LogoutConfirmModal open onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'modules.panel.logout.confirm' }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledWith('user');
  });

  it('cancel calls onClose without signing out', async () => {
    const onClose = vi.fn();
    render(<LogoutConfirmModal open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'modules.panel.logout.cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('disables cancel and shows the spinner on the confirm button while pending', () => {
    useLogout.mockReturnValue({ logout, isPending: true });
    render(<LogoutConfirmModal open onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'modules.panel.logout.cancel' })).toBeDisabled();
    const confirm = screen.getByRole('button', { name: 'modules.panel.logout.confirm' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
  });
});
