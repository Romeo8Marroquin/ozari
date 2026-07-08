import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks -----------------------------------------------------------------
// The data hook is mocked so the test drives every outcome via the callbacks the
// page passes to `login(data, { onSuccess, onError, onSettled })`.
const { login } = vi.hoisted(() => ({ login: vi.fn() }));
const { leaveTo, redirectAfterSuccess, swapFormColumn } = vi.hoisted(() => ({
  leaveTo: vi.fn(),
  redirectAfterSuccess: vi.fn(),
  // Drives the deferred content swap; run the commit synchronously so the step change is testable.
  swapFormColumn: vi.fn((commit: () => void) => commit()),
}));
const notifyMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));

// The MFA step is a black box here (covered by its own test); capture its props to exercise the
// page's wiring (verified → redirect, expired/back → revert to credentials).
interface MfaStepProps {
  mfaToken: string;
  onVerified: () => void;
  onExpired: () => void;
  onBack: () => void;
  disabled?: boolean;
}
const mfaStep = vi.hoisted(() => ({ props: null as MfaStepProps | null }));
vi.mock('./MfaLoginStep', () => ({
  default: (props: MfaStepProps) => {
    mfaStep.props = props;
    return <div data-testid="mfa-step">mfa</div>;
  },
}));
// Mutable state read by the mock factories on every render.
const state = vi.hoisted(() => ({ isPending: false }));
const searchState = vi.hoisted(() => ({ value: {} as { redirect?: string } }));
const gestureState = vi.hoisted(() => ({ value: false }));

vi.mock('../hooks/useLogin', () => ({ default: () => ({ login, isPending: state.isPending }) }));
vi.mock('../hooks/useAuthCard', () => ({
  default: () => ({ containerRef: { current: null }, leaveTo, redirectAfterSuccess, swapFormColumn }),
}));
vi.mock('@tanstack/react-router', () => ({ useSearch: () => searchState.value }));
vi.mock('@components/notifications/notify', () => ({ notify: notifyMock }));
vi.mock('@hooks/useUserGesture', () => ({ hasUserGestured: () => gestureState.value }));

import LoginPage from './LoginPage';

const VALID_EMAIL = 'user@test.com';
const VALID_PASSWORD = 'Passw0rd!123';

function makeAxiosError(status?: number, data: unknown = {}): AxiosError {
  const response =
    status === undefined
      ? undefined
      : { status, data, statusText: '', headers: {}, config: {} as never };
  return new AxiosError('Request failed', 'ERR', {} as never, {}, response as never);
}

const emailInput = () => screen.getByTestId('email-input');
const passwordInput = () => screen.getByTestId('password-input');
const submitButton = () => screen.getByRole('button', { name: /submitButton/ });

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(emailInput(), VALID_EMAIL);
  await user.type(passwordInput(), VALID_PASSWORD);
}

/** Submit via a real click and return the callbacks captured from the mocked mutation. */
async function submitAndGetHandlers(user: ReturnType<typeof userEvent.setup>) {
  await user.click(submitButton());
  await waitFor(() => expect(login).toHaveBeenCalled());
  const call = login.mock.calls[login.mock.calls.length - 1];
  return call[1] as {
    onSettled: () => void;
    onSuccess: (r: { data?: { data?: unknown }; headers: Record<string, string> }) => void;
    onError: (e: unknown) => void;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.isPending = false;
  searchState.value = {};
  gestureState.value = false;
  mfaStep.props = null;
  swapFormColumn.mockImplementation((commit: () => void) => commit());
});
afterEach(() => vi.restoreAllMocks());

describe('LoginPage', () => {
  it('renders the login form', () => {
    render(<LoginPage />);
    expect(emailInput()).toBeInTheDocument();
    expect(passwordInput()).toBeInTheDocument();
    expect(submitButton()).toBeInTheDocument();
  });

  it('submits valid credentials and calls login once', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    await submitAndGetHandlers(user);
    expect(login).toHaveBeenCalledWith(
      { email: VALID_EMAIL, password: VALID_PASSWORD },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('on success with an auth header redirects to the default panel and clears the lock via onSettled', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onSuccess({ data: {}, headers: { authorization: 'Bearer T' } }));
    expect(redirectAfterSuccess).toHaveBeenCalledWith('/panel/productos');
    act(() => handlers.onSettled());
  });

  it('on success honors a redirect target from the search params', async () => {
    searchState.value = { redirect: '/panel/settings' };
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onSuccess({ data: {}, headers: { authorization: 'Bearer T' } }));
    expect(redirectAfterSuccess).toHaveBeenCalledWith('/panel/settings');
  });

  it('on success with mfaRequired swaps to the in-card MFA step (no redirect, no toast)', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() =>
      handlers.onSuccess({ data: { data: { mfaRequired: true, mfaToken: 'MT' } }, headers: {} }),
    );
    expect(swapFormColumn).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('mfa-step')).toBeInTheDocument();
    expect(mfaStep.props?.mfaToken).toBe('MT');
    expect(redirectAfterSuccess).not.toHaveBeenCalled();
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('MFA verified runs the leave-to-panel redirect', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);
    act(() =>
      handlers.onSuccess({ data: { data: { mfaRequired: true, mfaToken: 'MT' } }, headers: {} }),
    );
    await screen.findByTestId('mfa-step');

    act(() => mfaStep.props?.onVerified());
    expect(redirectAfterSuccess).toHaveBeenCalledWith('/panel/productos');
  });

  it('MFA expired (401) reverts to the credentials step with a message', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);
    act(() =>
      handlers.onSuccess({ data: { data: { mfaRequired: true, mfaToken: 'MT' } }, headers: {} }),
    );
    await screen.findByTestId('mfa-step');

    act(() => mfaStep.props?.onExpired());
    expect(screen.queryByTestId('mfa-step')).toBeNull();
    expect(emailInput()).toBeInTheDocument();
    expect(await screen.findByText('modules.sesion.login.mfa.errors.expired')).toBeInTheDocument();
  });

  it('MFA "back" reverts to the credentials step', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);
    act(() =>
      handlers.onSuccess({ data: { data: { mfaRequired: true, mfaToken: 'MT' } }, headers: {} }),
    );
    await screen.findByTestId('mfa-step');

    act(() => mfaStep.props?.onBack());
    expect(screen.queryByTestId('mfa-step')).toBeNull();
    expect(emailInput()).toBeInTheDocument();
  });

  it('on success with neither header nor mfa shows the generic login error toast', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onSuccess({ data: {}, headers: {} }));
    expect(notifyMock.error).toHaveBeenCalledWith('modules.sesion.login.api.loginError');
  });

  it('on a 401 error renders the message inline (no toast)', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onError(makeAxiosError(401, {})));
    expect(await screen.findByText('modules.sesion.login.api.invalidCredentials')).toBeInTheDocument();
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('on a 500 error surfaces a toast (not inline)', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onError(makeAxiosError(500, {})));
    expect(notifyMock.error).toHaveBeenCalledWith('errors.server');
  });

  it('on an outage status (503) shows neither inline nor toast', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    const handlers = await submitAndGetHandlers(user);

    act(() => handlers.onError(makeAxiosError(503, {})));
    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(screen.queryByText('modules.sesion.login.api.invalidCredentials')).toBeNull();
  });

  it('ignores a re-submit while the previous one is still in flight (submit lock)', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    await submitAndGetHandlers(user); // first submit -> lock stays held (no onSettled)
    await user.click(submitButton()); // second submit -> early return
    await new Promise((r) => setTimeout(r, 20));
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('does not submit while a request is pending (isPending guard)', async () => {
    state.isPending = true;
    const user = userEvent.setup();
    const { container } = render(<LoginPage />);
    await fillValid(user);
    fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 30));
    expect(login).not.toHaveBeenCalled();
  });

  it('submits from a primary pointerdown on the button', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    fireEvent.pointerDown(submitButton(), { isPrimary: true });
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
  });

  it('ignores a non-primary pointerdown on the button', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await fillValid(user);
    fireEvent.pointerDown(submitButton(), { isPrimary: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(login).not.toHaveBeenCalled();
  });

  it('navigates to register when the sign-up link is clicked', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: /signUpLink/ }));
    expect(leaveTo).toHaveBeenCalledWith('/sesion/registro');
  });

  it('clears the pending blur timer on unmount', async () => {
    const { unmount } = render(<LoginPage />);
    unmount();
    // no assertion beyond executing the cleanup path without throwing
    expect(login).not.toHaveBeenCalled();
  });

  describe('autofill auto-submit on blur', () => {
    // Marks a field as autofilled via the animationstart signal the app listens for. jsdom has no
    // AnimationEvent, so `animationName` is defined manually on the event before dispatch.
    const fireAutofill = (el: HTMLElement) => {
      const ev = createEvent.animationStart(el);
      Object.defineProperty(ev, 'animationName', { value: 'onAutofill' });
      fireEvent(el, ev);
    };

    it('auto-submits when an autofilled, valid, gestured form is blurred', async () => {
      gestureState.value = true;
      const user = userEvent.setup();
      render(<LoginPage />);
      await fillValid(user);
      fireAutofill(emailInput());
      await user.tab(); // blur the focused input -> schedules the debounced submit
      await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    });

    it('does not auto-submit when no field was autofilled', async () => {
      gestureState.value = true;
      const user = userEvent.setup();
      render(<LoginPage />);
      await fillValid(user);
      await user.tab();
      await new Promise((r) => setTimeout(r, 150));
      expect(login).not.toHaveBeenCalled();
    });

    it('does not auto-submit without a genuine user gesture', async () => {
      gestureState.value = false;
      const user = userEvent.setup();
      render(<LoginPage />);
      await fillValid(user);
      fireAutofill(emailInput());
      await user.tab();
      await new Promise((r) => setTimeout(r, 150));
      expect(login).not.toHaveBeenCalled();
    });

    it('does not auto-submit while a request is pending', async () => {
      state.isPending = true;
      gestureState.value = true;
      const user = userEvent.setup();
      render(<LoginPage />);
      await fillValid(user);
      fireAutofill(emailInput());
      await user.tab();
      await new Promise((r) => setTimeout(r, 150));
      expect(login).not.toHaveBeenCalled();
    });

    it('does not auto-submit when the credentials are unchanged since the last submit', async () => {
      gestureState.value = true;
      const user = userEvent.setup();
      render(<LoginPage />);
      fireAutofill(emailInput());
      await user.click(emailInput());
      await user.tab(); // blur with the (unchanged) empty defaults
      await new Promise((r) => setTimeout(r, 150));
      expect(login).not.toHaveBeenCalled();
    });

    it('does not auto-submit when the form is invalid', async () => {
      gestureState.value = true;
      const user = userEvent.setup();
      render(<LoginPage />);
      await user.type(emailInput(), 'not-an-email');
      fireAutofill(emailInput());
      await user.tab();
      await new Promise((r) => setTimeout(r, 150));
      expect(login).not.toHaveBeenCalled();
    });

    it('does not auto-submit while a submit lock is held', async () => {
      gestureState.value = true;
      const user = userEvent.setup();
      render(<LoginPage />);
      await fillValid(user);
      await submitAndGetHandlers(user); // holds the lock (no onSettled)
      fireAutofill(emailInput());
      await user.click(emailInput());
      await user.tab();
      await new Promise((r) => setTimeout(r, 150));
      expect(login).toHaveBeenCalledTimes(1);
    });

    it('ignores a blur that does not originate from an input', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);
      await user.type(passwordInput(), 'x');
      await user.tab(); // blur password (INPUT) -> focus submit button
      await user.tab(); // blur submit button (non-INPUT) -> early return
      await new Promise((r) => setTimeout(r, 120));
      expect(login).not.toHaveBeenCalled();
    });
  });
});
