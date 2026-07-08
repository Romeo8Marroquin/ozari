import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The verify hook is mocked so the test drives every outcome via the callbacks the step passes to
// `verify(vars, { onSuccess, onError, onSettled })`.
const { verify, state } = vi.hoisted(() => ({ verify: vi.fn(), state: { isPending: false } }));
vi.mock('../hooks/useMfaVerifyLogin', () => ({
  useMfaVerifyLogin: () => ({ verify, isPending: state.isPending }),
}));
const notifyMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: notifyMock }));

import MfaLoginStep from './MfaLoginStep';

const KEY = 'modules.sesion.login.mfa';

const makeProps = () => ({ mfaToken: 'MT', onVerified: vi.fn(), onExpired: vi.fn(), onBack: vi.fn() });

function makeAxiosError(status?: number, data: unknown = {}): AxiosError {
  const response =
    status === undefined
      ? undefined
      : { status, data, statusText: '', headers: {}, config: {} as never };
  return new AxiosError('Request failed', 'ERR', {} as never, {}, response as never);
}

const codeInput = () => screen.getByLabelText(`${KEY}.codeLabel`) as HTMLInputElement;
const verifyButton = () => screen.getByRole('button', { name: `${KEY}.verifyButton` });

/** The options object from the most recent `verify(...)` call. */
const lastHandlers = () =>
  verify.mock.calls[verify.mock.calls.length - 1][1] as {
    onSettled: () => void;
    onSuccess: (r: { headers: Record<string, string> }) => void;
    onError: (e: unknown) => void;
  };

beforeEach(() => {
  vi.clearAllMocks();
  state.isPending = false;
});
afterEach(() => vi.restoreAllMocks());

describe('MfaLoginStep', () => {
  it('renders the TOTP field and verify button by default', () => {
    render(<MfaLoginStep {...makeProps()} />);
    expect(codeInput()).toHaveAttribute('inputmode', 'numeric');
    expect(verifyButton()).toBeInTheDocument();
  });

  it('submits a typed code with the mfaToken on the button (no auto-submit while typing)', async () => {
    const user = userEvent.setup();
    render(<MfaLoginStep {...makeProps()} />);
    await user.type(codeInput(), '123456');
    expect(verify).not.toHaveBeenCalled(); // typing never auto-submits

    await user.click(verifyButton());
    await waitFor(() => expect(verify).toHaveBeenCalled());
    expect(verify).toHaveBeenCalledWith({ code: '123456', mfaToken: 'MT' }, expect.any(Object));
  });

  it('auto-submits once on a bulk fill (paste/autofill) and dedupes the same code', async () => {
    render(<MfaLoginStep {...makeProps()} />);
    const input = codeInput();
    fireEvent.change(input, { target: { value: '123456' } }); // bulk → submit
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));

    // A password manager re-filling the SAME code must not loop (dedupe guard).
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: '123456' } });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('ignores a second auto-submit while the first is still in flight (submit lock)', async () => {
    render(<MfaLoginStep {...makeProps()} />);
    const input = codeInput();
    fireEvent.change(input, { target: { value: '123456' } }); // holds the lock (no onSettled)
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: '654321' } }); // different code, but lock held
    await new Promise((r) => setTimeout(r, 20));
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('does not submit while a request is pending (isPending guard)', async () => {
    state.isPending = true;
    render(<MfaLoginStep {...makeProps()} />);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(verify).not.toHaveBeenCalled();
  });

  it('calls onVerified when the response carries a session', async () => {
    const props = makeProps();
    render(<MfaLoginStep {...props} />);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    await waitFor(() => expect(verify).toHaveBeenCalled());

    const handlers = lastHandlers();
    act(() => handlers.onSuccess({ headers: { authorization: 'Bearer T' } }));
    act(() => handlers.onSettled()); // releases the in-flight lock
    expect(props.onVerified).toHaveBeenCalled();
  });

  it('shows an inline error when a 2xx carries no session (defensive)', async () => {
    const props = makeProps();
    render(<MfaLoginStep {...props} />);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    await waitFor(() => expect(verify).toHaveBeenCalled());

    act(() => lastHandlers().onSuccess({ headers: {} }));
    expect(await screen.findByText(`${KEY}.errors.invalidCode`)).toBeInTheDocument();
    expect(props.onVerified).not.toHaveBeenCalled();
  });

  it('renders a wrong-code (422) inline, preferring the server message', async () => {
    render(<MfaLoginStep {...makeProps()} />);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    await waitFor(() => expect(verify).toHaveBeenCalled());

    act(() => lastHandlers().onError(makeAxiosError(422, { message: 'server-wrong' })));
    expect(await screen.findByText('server-wrong')).toBeInTheDocument();
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('falls back to the local invalid-code copy on a 422 with no server message', async () => {
    render(<MfaLoginStep {...makeProps()} />);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    await waitFor(() => expect(verify).toHaveBeenCalled());

    act(() => lastHandlers().onError(makeAxiosError(422, {})));
    expect(await screen.findByText(`${KEY}.errors.invalidCode`)).toBeInTheDocument();
  });

  it('calls onExpired on a 401 (challenge expired)', async () => {
    const props = makeProps();
    render(<MfaLoginStep {...props} />);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    await waitFor(() => expect(verify).toHaveBeenCalled());

    act(() => lastHandlers().onError(makeAxiosError(401, {})));
    expect(props.onExpired).toHaveBeenCalled();
  });

  it('renders a lockout (429) inline', async () => {
    render(<MfaLoginStep {...makeProps()} />);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    await waitFor(() => expect(verify).toHaveBeenCalled());

    act(() => lastHandlers().onError(makeAxiosError(429, {})));
    expect(await screen.findByText(`${KEY}.errors.locked`)).toBeInTheDocument();
  });

  it('defers an outage (503) to the overlay (no inline, no toast)', async () => {
    render(<MfaLoginStep {...makeProps()} />);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    await waitFor(() => expect(verify).toHaveBeenCalled());

    act(() => lastHandlers().onError(makeAxiosError(503, {})));
    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(screen.queryByText(`${KEY}.errors.invalidCode`)).toBeNull();
  });

  it('toasts a 500', async () => {
    render(<MfaLoginStep {...makeProps()} />);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    await waitFor(() => expect(verify).toHaveBeenCalled());

    act(() => lastHandlers().onError(makeAxiosError(500, {})));
    expect(notifyMock.error).toHaveBeenCalledWith('errors.server');
  });

  it('shows a generic inline error for a non-axios failure', async () => {
    render(<MfaLoginStep {...makeProps()} />);
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    await waitFor(() => expect(verify).toHaveBeenCalled());

    act(() => lastHandlers().onError(new Error('boom')));
    expect(await screen.findByText('errors.generic')).toBeInTheDocument();
  });

  it('toggles to the recovery code field and back, submitting a 16-char code', async () => {
    const user = userEvent.setup();
    render(<MfaLoginStep {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: `${KEY}.useRecoveryCode` }));
    const recovery = screen.getByLabelText(`${KEY}.recoveryLabel`) as HTMLInputElement;
    expect(recovery).toHaveAttribute('inputmode', 'text');

    await user.type(recovery, 'ABCD2345EFGH6723');
    await user.click(verifyButton());
    await waitFor(() =>
      expect(verify).toHaveBeenCalledWith(
        { code: 'ABCD2345EFGH6723', mfaToken: 'MT' },
        expect.any(Object),
      ),
    );

    // Toggle back to the authenticator field.
    await user.click(screen.getByRole('button', { name: `${KEY}.useAuthenticator` }));
    expect(codeInput()).toBeInTheDocument();
  });

  it('calls onBack from the "volver" affordance', async () => {
    const props = makeProps();
    const user = userEvent.setup();
    render(<MfaLoginStep {...props} />);
    await user.click(screen.getByRole('button', { name: `${KEY}.back` }));
    expect(props.onBack).toHaveBeenCalled();
  });
});
