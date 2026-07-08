import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosError } from 'axios';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Control the mutation: capture the { onSuccess, onError } handlers the modal passes to `mutate`.
const { disableMfa } = vi.hoisted(() => ({ disableMfa: vi.fn() }));
const { useMfaDisable } = vi.hoisted(() => ({ useMfaDisable: vi.fn() }));
vi.mock('./useMfaDisable', () => ({ useMfaDisable }));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

import MfaDisableModal from './MfaDisableModal';

const KEY = 'modules.panel.settings.security.mfa.disable';
const PASSWORD = 'Secret123!abc';

type Handlers = { onSuccess: () => void; onError: (error: unknown) => void };

/** Fill the password and submit; returns the captured mutation handlers. */
const submitPassword = async (): Promise<Handlers> => {
  await userEvent.type(screen.getByPlaceholderText(`${KEY}.passwordPlaceholder`), PASSWORD);
  await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
  await waitFor(() => expect(disableMfa).toHaveBeenCalled());
  return disableMfa.mock.calls[0][1] as Handlers;
};

const axiosError = (status: number, message?: string): AxiosError =>
  ({
    isAxiosError: true,
    response: { status, data: message ? { message } : {} },
  }) as unknown as AxiosError;

beforeEach(() => {
  vi.clearAllMocks();
  useMfaDisable.mockReturnValue({ disableMfa, isPending: false });
});
afterEach(() => vi.restoreAllMocks());

describe('MfaDisableModal', () => {
  it('renders nothing meaningful when closed', () => {
    render(<MfaDisableModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByText(`${KEY}.title`)).not.toBeInTheDocument();
  });

  it('states the consequence in a warning note when open', () => {
    render(<MfaDisableModal open onClose={vi.fn()} />);
    expect(screen.getByRole('note')).toHaveTextContent(`${KEY}.warning`);
  });

  it('submits the password and, on success, toasts + closes', async () => {
    const onClose = vi.fn();
    render(<MfaDisableModal open onClose={onClose} />);

    const handlers = await submitPassword();
    expect(disableMfa).toHaveBeenCalledWith({ password: PASSWORD }, expect.any(Object));

    act(() => handlers.onSuccess());
    expect(success).toHaveBeenCalledWith(`${KEY}.successToast`, { title: `${KEY}.successTitle` });
    expect(onClose).toHaveBeenCalled();
  });

  it('a non-axios error toasts a generic message', async () => {
    render(<MfaDisableModal open onClose={vi.fn()} />);
    const handlers = await submitPassword();

    act(() => handlers.onError(new Error('boom')));
    expect(error).toHaveBeenCalledWith('errors.generic');
  });

  it('a 422 (wrong password) marks the field invalid (server message wins), no toast', async () => {
    render(<MfaDisableModal open onClose={vi.fn()} />);
    const handlers = await submitPassword();

    act(() => handlers.onError(axiosError(422, 'Contraseña incorrecta')));
    expect(document.getElementById('mfa-disable-password')).toHaveAttribute('aria-invalid', 'true');
    expect(error).not.toHaveBeenCalled();
  });

  it('a 401 (defensive fallback) also marks the field invalid', async () => {
    render(<MfaDisableModal open onClose={vi.fn()} />);
    const handlers = await submitPassword();

    act(() => handlers.onError(axiosError(401)));
    expect(document.getElementById('mfa-disable-password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('an outage status is swallowed (owned by the app overlay) — no inline error, no toast', async () => {
    render(<MfaDisableModal open onClose={vi.fn()} />);
    const handlers = await submitPassword();

    act(() => handlers.onError(axiosError(503)));
    expect(document.getElementById('mfa-disable-password')).not.toHaveAttribute('aria-invalid');
    expect(error).not.toHaveBeenCalled();
  });

  it('any other server error (5xx) falls through to a toast', async () => {
    render(<MfaDisableModal open onClose={vi.fn()} />);
    const handlers = await submitPassword();

    act(() => handlers.onError(axiosError(500)));
    expect(error).toHaveBeenCalledWith('errors.server');
  });

  it('ignores a submit while a request is already in flight', async () => {
    useMfaDisable.mockReturnValue({ disableMfa, isPending: true });
    render(<MfaDisableModal open onClose={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(`${KEY}.passwordPlaceholder`), PASSWORD);
    const form = document.getElementById('mfa-disable-form') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });

    expect(disableMfa).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: `${KEY}.cancel` })).toBeDisabled();
  });

  it('resets the form when it closes', async () => {
    const { rerender } = render(<MfaDisableModal open onClose={vi.fn()} />);
    const field = screen.getByPlaceholderText(`${KEY}.passwordPlaceholder`) as HTMLInputElement;
    await userEvent.type(field, 'something');
    expect(field.value).toBe('something');

    rerender(<MfaDisableModal open={false} onClose={vi.fn()} />);
    await waitFor(() =>
      expect((screen.getByPlaceholderText(`${KEY}.passwordPlaceholder`) as HTMLInputElement).value).toBe(''),
    );
  });
});
