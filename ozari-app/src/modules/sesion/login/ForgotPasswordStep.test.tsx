import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The request hook is mocked so the test drives every outcome via the callbacks the step passes to
// `requestReset(vars, { onSuccess, onError, onSettled })`.
const { requestReset, state } = vi.hoisted(() => ({ requestReset: vi.fn(), state: { isPending: false } }));
vi.mock('../hooks/useForgotPassword', () => ({
  useForgotPassword: () => ({ requestReset, isPending: state.isPending }),
}));
const notifyMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: notifyMock }));

import ForgotPasswordStep from './ForgotPasswordStep';

const KEY = 'modules.sesion.forgot';
const VALID_EMAIL = 'user@test.com';

function makeAxiosError(status?: number, data: unknown = {}): AxiosError {
  const response =
    status === undefined
      ? undefined
      : { status, data, statusText: '', headers: {}, config: {} as never };
  return new AxiosError('Request failed', 'ERR', {} as never, {}, response as never);
}

const emailInput = () => screen.getByTestId('forgot-email-input');
const submitButton = () => screen.getByRole('button', { name: `${KEY}.submitButton` });
const backButton = () => screen.getByRole('button', { name: `${KEY}.back` });

const lastHandlers = () =>
  requestReset.mock.calls[requestReset.mock.calls.length - 1][1] as {
    onSettled: () => void;
    onSuccess: () => void;
    onError: (e: unknown) => void;
  };

async function submitValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(emailInput(), VALID_EMAIL);
  await user.click(submitButton());
  await waitFor(() => expect(requestReset).toHaveBeenCalled());
}

const makeProps = () => ({ onBack: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  state.isPending = false;
});
afterEach(() => vi.restoreAllMocks());

describe('ForgotPasswordStep', () => {
  it('renders the email field, submit and back affordances', () => {
    render(<ForgotPasswordStep {...makeProps()} />);
    expect(emailInput()).toBeInTheDocument();
    expect(submitButton()).toBeInTheDocument();
    expect(backButton()).toBeInTheDocument();
  });

  it('submits a valid email once', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordStep {...makeProps()} />);
    await submitValid(user);
    expect(requestReset).toHaveBeenCalledWith({ email: VALID_EMAIL }, expect.any(Object));
  });

  it('on success fires the generic confirmation toast and returns to credentials', async () => {
    const props = makeProps();
    const user = userEvent.setup();
    render(<ForgotPasswordStep {...props} />);
    await submitValid(user);

    act(() => lastHandlers().onSuccess());
    expect(notifyMock.success).toHaveBeenCalledWith(`${KEY}.api.successToast`, {
      title: `${KEY}.api.successTitle`,
    });
    expect(props.onBack).toHaveBeenCalled();
    act(() => lastHandlers().onSettled());
  });

  it('renders a validation error (400) inline, preferring the server message', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordStep {...makeProps()} />);
    await submitValid(user);

    act(() => lastHandlers().onError(makeAxiosError(400, { message: 'server-bad' })));
    expect(await screen.findByText('server-bad')).toBeInTheDocument();
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('toasts a 500', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordStep {...makeProps()} />);
    await submitValid(user);

    act(() => lastHandlers().onError(makeAxiosError(500, {})));
    expect(notifyMock.error).toHaveBeenCalledWith('errors.server');
  });

  it('defers an outage (503) to the overlay (no inline, no toast)', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordStep {...makeProps()} />);
    await submitValid(user);

    act(() => lastHandlers().onError(makeAxiosError(503, {})));
    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(screen.queryByText(`${KEY}.api.requestError`)).toBeNull();
  });

  it('ignores a re-submit while the previous one is in flight (submit lock)', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordStep {...makeProps()} />);
    await submitValid(user); // first submit → lock held (no onSettled)
    await user.click(submitButton()); // second → early return
    await new Promise((r) => setTimeout(r, 20));
    expect(requestReset).toHaveBeenCalledTimes(1);
  });

  it('does not submit while a request is pending (isPending guard)', async () => {
    state.isPending = true;
    const user = userEvent.setup();
    const { container } = render(<ForgotPasswordStep {...makeProps()} />);
    await user.type(emailInput(), VALID_EMAIL);
    fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 20));
    expect(requestReset).not.toHaveBeenCalled();
  });

  it('calls onBack from the "volver" affordance', async () => {
    const props = makeProps();
    const user = userEvent.setup();
    render(<ForgotPasswordStep {...props} />);
    await user.click(backButton());
    expect(props.onBack).toHaveBeenCalled();
  });
});
