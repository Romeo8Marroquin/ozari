import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Control the two MFA mutations directly (their own wiring is covered by useMfa.test).
const mocks = vi.hoisted(() => ({
  setupMfa: vi.fn(),
  enableMfa: vi.fn(),
  setupPending: false,
  enablePending: false,
}));
vi.mock('./useMfa', () => ({
  useSetupMfa: () => ({ setupMfa: mocks.setupMfa, isPending: mocks.setupPending }),
  useEnableMfa: () => ({ enableMfa: mocks.enableMfa, isPending: mocks.enablePending }),
}));

const { info, error, success } = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { info, error, success } }));

import { createQueryWrapper } from '../../../test/queryWrapper';
import MfaEnableModal from './MfaEnableModal';

const KEY = 'modules.panel.settings.security.mfa.enable';
const SETUP = { secret: 'MYSECRETKEY234', otpauthUri: 'otpauth://totp/Ozari:ana@x?secret=MYSECRETKEY234' };

const axiosError = (status: number, message?: string): AxiosError =>
  ({ isAxiosError: true, response: { status, data: message ? { message } : {} } }) as unknown as AxiosError;

const renderModal = (open = true): { onClose: ReturnType<typeof vi.fn>; rerender: (open: boolean) => void } => {
  const onClose = vi.fn();
  const wrapper = createQueryWrapper();
  const { rerender } = render(<MfaEnableModal open={open} onClose={onClose} />, { wrapper });
  return { onClose, rerender: (next) => rerender(<MfaEnableModal open={next} onClose={onClose} />) };
};

// Render, wait for the QR/verify step, then enter a valid code and confirm.
const reachConfigureAndConfirm = async (): Promise<ReturnType<typeof vi.fn>> => {
  const { onClose } = renderModal();
  const input = await screen.findByLabelText(`${KEY}.codeLabel`);
  await userEvent.type(input, '123456');
  await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
  return onClose;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setupPending = false;
  mocks.enablePending = false;
  mocks.setupMfa.mockResolvedValue(SETUP);
  mocks.enableMfa.mockResolvedValue({ recoveryCodes: ['R1', 'R2', 'R3'] });
});
afterEach(() => vi.restoreAllMocks());

describe('MfaEnableModal', () => {
  it('renders nothing and skips setup while closed', () => {
    renderModal(false);
    expect(mocks.setupMfa).not.toHaveBeenCalled();
    expect(screen.queryByText(`${KEY}.title`)).not.toBeInTheDocument();
  });

  it('runs setup on open and shows the QR, manual secret and code field', async () => {
    renderModal();
    expect(mocks.setupMfa).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText(`${KEY}.codeLabel`)).toBeInTheDocument();
    expect(screen.getByText(SETUP.secret)).toBeInTheDocument();
    expect(screen.getByTitle(`${KEY}.qrTitle`)).toBeInTheDocument();
  });

  it('shows the skeleton while the secret is loading, then reveals the real content', async () => {
    let resolveSetup: (value: typeof SETUP) => void = () => {};
    mocks.setupMfa.mockReturnValue(new Promise((resolve) => (resolveSetup = resolve)));
    renderModal();

    // Skeleton state: the scan instruction is already visible, but no QR / secret / code field yet.
    expect(screen.getByText(`${KEY}.scanDescription`)).toBeInTheDocument();
    expect(screen.queryByTitle(`${KEY}.qrTitle`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`${KEY}.codeLabel`)).not.toBeInTheDocument();
    // Confirm is disabled until the secret lands.
    expect(screen.getByRole('button', { name: `${KEY}.confirm` })).toBeDisabled();

    resolveSetup(SETUP);
    expect(await screen.findByLabelText(`${KEY}.codeLabel`)).toBeInTheDocument();
    expect(screen.getByTitle(`${KEY}.qrTitle`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${KEY}.confirm` })).toBeEnabled();
  });

  it('shows the error step when setup returns no data', async () => {
    mocks.setupMfa.mockResolvedValue(null);
    renderModal();
    expect(await screen.findByText(`${KEY}.errors.setupFailed`)).toBeInTheDocument();
  });

  it('closes on a backend outage during setup (the overlay owns it)', async () => {
    mocks.setupMfa.mockRejectedValue(axiosError(503));
    const { onClose } = renderModal();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(error).not.toHaveBeenCalled();
  });

  it('settles as already-enabled on a 409 during setup', async () => {
    mocks.setupMfa.mockRejectedValue(axiosError(409));
    const { onClose } = renderModal();
    await waitFor(() => expect(info).toHaveBeenCalledWith(`${KEY}.alreadyEnabledToast`));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the error step on a non-axios setup failure', async () => {
    mocks.setupMfa.mockRejectedValue(new Error('boom'));
    renderModal();
    expect(await screen.findByText(`${KEY}.errors.setupFailed`)).toBeInTheDocument();
  });

  it('shows the error step on a generic setup failure and retries', async () => {
    mocks.setupMfa.mockRejectedValueOnce(axiosError(500)).mockResolvedValueOnce(SETUP);
    renderModal();
    await screen.findByText(`${KEY}.errors.setupFailed`);

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.retry` }));
    expect(await screen.findByLabelText(`${KEY}.codeLabel`)).toBeInTheDocument();
    expect(mocks.setupMfa).toHaveBeenCalledTimes(2);
  });

  it('confirms a valid code and reveals the one-time recovery codes, then done closes', async () => {
    const onClose = await reachConfigureAndConfirm();
    expect(await screen.findByText('R1')).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.recovery.title`)).toBeInTheDocument();
    expect(mocks.enableMfa).toHaveBeenCalledWith('123456');

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.recovery.done` }));
    expect(onClose).toHaveBeenCalled();
  });

  it('lands an invalid code (422, server message) inline on the field, no toast', async () => {
    mocks.enableMfa.mockRejectedValue(axiosError(422, 'bad code'));
    await reachConfigureAndConfirm();

    await waitFor(() =>
      expect(screen.getByLabelText(`${KEY}.codeLabel`)).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(error).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('lands an invalid code (401 defensive fallback, no message → fallback copy) inline', async () => {
    mocks.enableMfa.mockRejectedValue(axiosError(401));
    await reachConfigureAndConfirm();
    await waitFor(() =>
      expect(screen.getByLabelText(`${KEY}.codeLabel`)).toHaveAttribute('aria-invalid', 'true'),
    );
  });

  it('settles as already-enabled on a 409 during confirm', async () => {
    mocks.enableMfa.mockRejectedValue(axiosError(409));
    const onClose = await reachConfigureAndConfirm();
    await waitFor(() => expect(info).toHaveBeenCalledWith(`${KEY}.alreadyEnabledToast`));
    expect(onClose).toHaveBeenCalled();
  });

  it('on a 400 (expired secret, server message) toasts and restarts setup', async () => {
    mocks.enableMfa.mockRejectedValue(axiosError(400, 'expired'));
    await reachConfigureAndConfirm();
    await waitFor(() => expect(error).toHaveBeenCalledWith('expired'));
    // Restarted enrollment → setup ran a second time.
    await waitFor(() => expect(mocks.setupMfa).toHaveBeenCalledTimes(2));
  });

  it('on a 400 with no message uses the fallback copy and restarts setup', async () => {
    mocks.enableMfa.mockRejectedValue(axiosError(400));
    await reachConfigureAndConfirm();
    await waitFor(() => expect(error).toHaveBeenCalledWith(`${KEY}.errors.setupExpired`));
    await waitFor(() => expect(mocks.setupMfa).toHaveBeenCalledTimes(2));
  });

  it('swallows an outage during confirm (no toast, stays on the step)', async () => {
    mocks.enableMfa.mockRejectedValue(axiosError(503));
    await reachConfigureAndConfirm();
    await waitFor(() => expect(mocks.enableMfa).toHaveBeenCalled());
    expect(error).not.toHaveBeenCalled();
    expect(screen.getByLabelText(`${KEY}.codeLabel`)).toBeInTheDocument();
  });

  it('toasts an ambient server error (5xx) during confirm', async () => {
    mocks.enableMfa.mockRejectedValue(axiosError(500));
    await reachConfigureAndConfirm();
    await waitFor(() => expect(error).toHaveBeenCalledWith('errors.server'));
  });

  it('toasts a generic message when confirm resolves without data', async () => {
    mocks.enableMfa.mockResolvedValue(null);
    await reachConfigureAndConfirm();
    await waitFor(() => expect(error).toHaveBeenCalledWith('errors.generic'));
  });

  it('toasts a generic message on a non-axios confirm error', async () => {
    mocks.enableMfa.mockRejectedValue(new Error('boom'));
    await reachConfigureAndConfirm();
    await waitFor(() => expect(error).toHaveBeenCalledWith('errors.generic'));
  });

  it('ignores a submit while a confirm is already in flight', async () => {
    mocks.enablePending = true;
    renderModal();
    const input = await screen.findByLabelText(`${KEY}.codeLabel`);
    await userEvent.type(input, '123456');

    const form = document.getElementById('mfa-enable-form') as HTMLFormElement;
    form.requestSubmit();
    // The in-flight guard short-circuits before the mutation.
    expect(mocks.enableMfa).not.toHaveBeenCalled();
  });

  it('resets and re-runs setup when reopened', async () => {
    const { rerender } = renderModal();
    await screen.findByLabelText(`${KEY}.codeLabel`);

    rerender(false);
    rerender(true);
    await waitFor(() => expect(mocks.setupMfa).toHaveBeenCalledTimes(2));
  });
});
