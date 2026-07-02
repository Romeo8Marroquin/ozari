import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosError } from 'axios';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Control the mutation: capture the { onSuccess, onError } handlers the modal passes to `mutate`
// so we can invoke each branch directly.
const { changePassword } = vi.hoisted(() => ({ changePassword: vi.fn() }));
const { useChangePassword } = vi.hoisted(() => ({ useChangePassword: vi.fn() }));
vi.mock('./useChangePassword', () => ({ useChangePassword }));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

import ChangePasswordModal from './ChangePasswordModal';

const KEY = 'modules.panel.settings.security.password.modal';

// Valid, distinct passwords that satisfy the mirrored policy (12+ chars, upper/lower/digit/symbol).
const CURRENT = 'Zyxwvu2@tsrq';
const NEXT = 'Abcdef1!ghij';

type Handlers = {
  onSuccess: () => void;
  onError: (error: unknown) => void;
};

/** Fill the three fields with valid data and submit; returns the captured mutation handlers. */
const submitValid = async (): Promise<Handlers> => {
  await userEvent.type(screen.getByPlaceholderText(`${KEY}.currentPlaceholder`), CURRENT);
  await userEvent.type(screen.getByPlaceholderText(`${KEY}.newPlaceholder`), NEXT);
  await userEvent.type(screen.getByPlaceholderText(`${KEY}.confirmPlaceholder`), NEXT);
  await userEvent.click(screen.getByRole('button', { name: `${KEY}.submit` }));

  await waitFor(() => expect(changePassword).toHaveBeenCalled());
  return changePassword.mock.calls[0][1] as Handlers;
};

const axiosError = (status: number, message?: string): AxiosError =>
  ({
    isAxiosError: true,
    response: { status, data: message ? { message } : {} },
  }) as unknown as AxiosError;

beforeEach(() => {
  vi.clearAllMocks();
  useChangePassword.mockReturnValue({ changePassword, isPending: false });
});
afterEach(() => vi.restoreAllMocks());

describe('ChangePasswordModal', () => {
  it('renders nothing meaningful when closed', () => {
    render(<ChangePasswordModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByText(`${KEY}.title`)).not.toBeInTheDocument();
  });

  it('submits valid data and, on success, toasts + closes', async () => {
    const onClose = vi.fn();
    render(<ChangePasswordModal open onClose={onClose} />);

    const handlers = await submitValid();
    expect(changePassword).toHaveBeenCalledWith(
      { currentPassword: CURRENT, newPassword: NEXT, confirmPassword: NEXT },
      expect.any(Object),
    );

    act(() => handlers.onSuccess());
    expect(success).toHaveBeenCalledWith(`${KEY}.successToast`, { title: `${KEY}.successTitle` });
    expect(onClose).toHaveBeenCalled();
  });

  it('a non-axios error toasts a generic message', async () => {
    render(<ChangePasswordModal open onClose={vi.fn()} />);
    const handlers = await submitValid();

    act(() => handlers.onError(new Error('boom')));
    expect(error).toHaveBeenCalledWith('errors.generic');
  });

  it('a 401 marks the current-password field invalid (server message wins)', async () => {
    render(<ChangePasswordModal open onClose={vi.fn()} />);
    const handlers = await submitValid();

    act(() => handlers.onError(axiosError(401, 'Contraseña incorrecta')));
    expect(document.getElementById('current-password')).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('new-password')).not.toHaveAttribute('aria-invalid');
    expect(error).not.toHaveBeenCalled();
  });

  it('a 401 without a server message uses the fallback copy inline', async () => {
    render(<ChangePasswordModal open onClose={vi.fn()} />);
    const handlers = await submitValid();

    act(() => handlers.onError(axiosError(401)));
    expect(document.getElementById('current-password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('a 400 marks the new-password field invalid (server message wins)', async () => {
    render(<ChangePasswordModal open onClose={vi.fn()} />);
    const handlers = await submitValid();

    act(() => handlers.onError(axiosError(400, 'La nueva contraseña ya se usó')));
    expect(document.getElementById('new-password')).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('current-password')).not.toHaveAttribute('aria-invalid');
  });

  it('a 409 marks the new-password field invalid (fallback copy)', async () => {
    render(<ChangePasswordModal open onClose={vi.fn()} />);
    const handlers = await submitValid();

    act(() => handlers.onError(axiosError(409)));
    expect(document.getElementById('new-password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('an outage status is swallowed (owned by the app overlay) — no inline error, no toast', async () => {
    render(<ChangePasswordModal open onClose={vi.fn()} />);
    const handlers = await submitValid();

    act(() => handlers.onError(axiosError(503)));
    expect(document.getElementById('current-password')).not.toHaveAttribute('aria-invalid');
    expect(document.getElementById('new-password')).not.toHaveAttribute('aria-invalid');
    expect(error).not.toHaveBeenCalled();
  });

  it('any other server error (5xx) falls through to a toast', async () => {
    render(<ChangePasswordModal open onClose={vi.fn()} />);
    const handlers = await submitValid();

    act(() => handlers.onError(axiosError(500)));
    expect(error).toHaveBeenCalledWith('errors.server');
  });

  it('ignores a submit while a request is already in flight', async () => {
    useChangePassword.mockReturnValue({ changePassword, isPending: true });
    render(<ChangePasswordModal open onClose={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(`${KEY}.currentPlaceholder`), CURRENT);
    await userEvent.type(screen.getByPlaceholderText(`${KEY}.newPlaceholder`), NEXT);
    await userEvent.type(screen.getByPlaceholderText(`${KEY}.confirmPlaceholder`), NEXT);

    const form = document.getElementById('change-password-form') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });

    // The in-flight guard short-circuits before calling the mutation.
    expect(changePassword).not.toHaveBeenCalled();
    // Cancel is disabled while pending.
    expect(screen.getByRole('button', { name: `${KEY}.cancel` })).toBeDisabled();
  });

  it('resets the form when it closes', async () => {
    const { rerender } = render(<ChangePasswordModal open onClose={vi.fn()} />);
    const current = screen.getByPlaceholderText(`${KEY}.currentPlaceholder`) as HTMLInputElement;
    await userEvent.type(current, 'something');
    expect(current.value).toBe('something');

    rerender(<ChangePasswordModal open={false} onClose={vi.fn()} />);
    // The reset-on-close effect clears the field while the modal is still mounted (fading out).
    await waitFor(() =>
      expect((screen.getByPlaceholderText(`${KEY}.currentPlaceholder`) as HTMLInputElement).value).toBe(''),
    );
  });
});
