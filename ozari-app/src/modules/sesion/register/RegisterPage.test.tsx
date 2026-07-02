import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks -----------------------------------------------------------------
const { registerUser } = vi.hoisted(() => ({ registerUser: vi.fn() }));
const { leaveTo } = vi.hoisted(() => ({ leaveTo: vi.fn() }));
const notifyMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
const state = vi.hoisted(() => ({ isPending: false }));

vi.mock('../hooks/useRegister', () => ({
  default: () => ({ register: registerUser, isPending: state.isPending }),
}));
vi.mock('../hooks/useAuthCard', () => ({
  default: () => ({ containerRef: { current: null }, leaveTo }),
}));
vi.mock('@components/notifications/notify', () => ({ notify: notifyMock }));

import RegisterPage from './RegisterPage';

const VALID_NAME = 'Juan Perez';
const VALID_EMAIL = 'juan@test.com';
const VALID_PASSWORD = 'Passw0rd!123';

function makeAxiosError(status?: number, data: unknown = {}): AxiosError {
  const response =
    status === undefined
      ? undefined
      : { status, data, statusText: '', headers: {}, config: {} as never };
  return new AxiosError('Request failed', 'ERR', {} as never, {}, response as never);
}

const submitButton = () => screen.getByRole('button', { name: /submitButton/ });

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('fullName-input'), VALID_NAME);
  await user.type(screen.getByTestId('email-input'), VALID_EMAIL);
  await user.type(screen.getByTestId('password-input'), VALID_PASSWORD);
  await user.type(screen.getByTestId('confirmPassword-input'), VALID_PASSWORD);
  await user.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(submitButton()).toBeEnabled());
}

async function submitAndGetHandlers(user: ReturnType<typeof userEvent.setup>) {
  await user.click(submitButton());
  await waitFor(() => expect(registerUser).toHaveBeenCalled());
  const call = registerUser.mock.calls[registerUser.mock.calls.length - 1];
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

describe('RegisterPage', () => {
  it('renders the register form with a disabled submit until the form is valid', () => {
    render(<RegisterPage />);
    expect(screen.getByTestId('fullName-input')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('submits a valid form and calls register once', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user);
    await submitAndGetHandlers(user);
    expect(registerUser).toHaveBeenCalledWith(
      {
        fullName: VALID_NAME,
        email: VALID_EMAIL,
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
        termsAccepted: true,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('on success shows the success toast, resets, and animates back to login', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onSuccess());
    expect(notifyMock.success).toHaveBeenCalledWith(
      'modules.sesion.register.api.registerSuccessToast',
      { title: 'modules.sesion.register.api.registerSuccessTitle' },
    );
    expect(leaveTo).toHaveBeenCalledWith('/sesion/inicio');
    act(() => handlers.onSettled());
  });

  it('on a 409 error renders the message inline (no toast)', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onError(makeAxiosError(409, {})));
    expect(await screen.findByText('modules.sesion.register.api.registerError')).toBeInTheDocument();
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('on a 500 error surfaces a toast (not inline)', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onError(makeAxiosError(500, {})));
    expect(notifyMock.error).toHaveBeenCalledWith('errors.server');
  });

  it('on an outage status (503) shows neither inline nor toast', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onError(makeAxiosError(503, {})));
    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(screen.queryByText('modules.sesion.register.api.registerError')).toBeNull();
  });

  it('ignores a re-submit while the previous one is still in flight (submit lock)', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValid(user);
    await submitAndGetHandlers(user); // first submit -> lock held (no onSettled)
    await user.click(submitButton()); // second submit -> early return
    await new Promise((r) => setTimeout(r, 20));
    expect(registerUser).toHaveBeenCalledTimes(1);
  });

  it('does not submit while a request is pending (isPending guard)', async () => {
    state.isPending = true;
    const user = userEvent.setup();
    const { container } = render(<RegisterPage />);
    // Fill valid values so the submit handler reaches the isPending guard.
    await user.type(screen.getByTestId('fullName-input'), VALID_NAME);
    await user.type(screen.getByTestId('email-input'), VALID_EMAIL);
    await user.type(screen.getByTestId('password-input'), VALID_PASSWORD);
    await user.type(screen.getByTestId('confirmPassword-input'), VALID_PASSWORD);
    await user.click(screen.getByRole('checkbox'));
    fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 30));
    expect(registerUser).not.toHaveBeenCalled();
  });

  it('navigates to login when the login link is clicked', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.click(screen.getByRole('button', { name: /loginLink/ }));
    expect(leaveTo).toHaveBeenCalledWith('/sesion/inicio');
  });
});
