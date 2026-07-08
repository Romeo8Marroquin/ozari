import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resetPassword } = vi.hoisted(() => ({ resetPassword: vi.fn() }));
const { leaveTo } = vi.hoisted(() => ({ leaveTo: vi.fn() }));
const notifyMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
const state = vi.hoisted(() => ({ isPending: false }));

vi.mock('../hooks/useResetPassword', () => ({
  useResetPassword: () => ({ resetPassword, isPending: state.isPending }),
}));
vi.mock('../hooks/useAuthCard', () => ({
  default: () => ({ containerRef: { current: null }, leaveTo }),
}));
vi.mock('@components/notifications/notify', () => ({ notify: notifyMock }));

import ResetPasswordPage from './ResetPasswordPage';

const KEY = 'modules.sesion.reset';
const TOKEN = 'TOK123';
const VALID_PASSWORD = 'Passw0rd!123';

function makeAxiosError(status?: number, data: unknown = {}): AxiosError {
  const response =
    status === undefined
      ? undefined
      : { status, data, statusText: '', headers: {}, config: {} as never };
  return new AxiosError('Request failed', 'ERR', {} as never, {}, response as never);
}

const submitButton = () => screen.getByRole('button', { name: `${KEY}.submitButton` });
const backButton = () => screen.getByRole('button', { name: `${KEY}.back` });

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('password-input'), VALID_PASSWORD);
  await user.type(screen.getByTestId('confirmPassword-input'), VALID_PASSWORD);
  await waitFor(() => expect(submitButton()).toBeEnabled());
}

async function submitAndGetHandlers(user: ReturnType<typeof userEvent.setup>) {
  await user.click(submitButton());
  await waitFor(() => expect(resetPassword).toHaveBeenCalled());
  const call = resetPassword.mock.calls[resetPassword.mock.calls.length - 1];
  return call[1] as {
    onSettled: () => void;
    onSuccess: () => void;
    onError: (e: unknown) => void;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.isPending = false;
});
afterEach(() => vi.restoreAllMocks());

describe('ResetPasswordPage', () => {
  it('renders the form with a disabled submit until valid', () => {
    render(<ResetPasswordPage token={TOKEN} />);
    expect(screen.getByTestId('password-input')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('submits the token with the new password once', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage token={TOKEN} />);
    await fillValid(user);
    await submitAndGetHandlers(user);
    expect(resetPassword).toHaveBeenCalledWith(
      { token: TOKEN, newPassword: VALID_PASSWORD, confirmPassword: VALID_PASSWORD },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('on success toasts and morphs to login', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage token={TOKEN} />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onSuccess());
    expect(notifyMock.success).toHaveBeenCalledWith(`${KEY}.api.successToast`, {
      title: `${KEY}.api.successTitle`,
    });
    expect(leaveTo).toHaveBeenCalledWith('/sesion/inicio');
    act(() => handlers.onSettled());
  });

  it('on an invalid/expired token (400) renders the message inline (no toast)', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage token={TOKEN} />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onError(makeAxiosError(400, {})));
    expect(await screen.findByText(`${KEY}.api.invalidToken`)).toBeInTheDocument();
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('on a 500 surfaces a toast (not inline)', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage token={TOKEN} />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onError(makeAxiosError(500, {})));
    expect(notifyMock.error).toHaveBeenCalledWith('errors.server');
  });

  it('on an outage status (503) shows neither inline nor toast', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage token={TOKEN} />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onError(makeAxiosError(503, {})));
    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(screen.queryByText(`${KEY}.api.invalidToken`)).toBeNull();
  });

  it('ignores a re-submit while the previous one is in flight (submit lock)', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage token={TOKEN} />);
    await fillValid(user);
    await submitAndGetHandlers(user); // first → lock held
    await user.click(submitButton()); // second → early return
    await new Promise((r) => setTimeout(r, 20));
    expect(resetPassword).toHaveBeenCalledTimes(1);
  });

  it('does not submit while a request is pending (isPending guard)', async () => {
    state.isPending = true;
    const user = userEvent.setup();
    const { container } = render(<ResetPasswordPage token={TOKEN} />);
    await user.type(screen.getByTestId('password-input'), VALID_PASSWORD);
    await user.type(screen.getByTestId('confirmPassword-input'), VALID_PASSWORD);
    fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 30));
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('navigates to login when the back link is clicked', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage token={TOKEN} />);
    await user.click(backButton());
    expect(leaveTo).toHaveBeenCalledWith('/sesion/inicio');
  });
});
