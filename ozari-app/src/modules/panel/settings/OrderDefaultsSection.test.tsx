import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

const { useAccountPreferences, updatePreferences, saving } = vi.hoisted(() => ({
  useAccountPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  saving: { value: false },
}));
vi.mock('./useAccountPreferences', () => ({
  useAccountPreferences,
  useUpdateAccountPreferences: () => ({ updatePreferences, isPending: saving.value }),
}));

const { notify } = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@components/notifications/notify', () => ({ notify }));

import OrderDefaultsSection from './OrderDefaultsSection';

const KEY = 'modules.panel.settings.orders.billedDays';

const setSaved = (orderBilledDays: number | null, isPending = false): void => {
  useAccountPreferences.mockReturnValue({
    data: isPending ? undefined : { orderBilledDays },
    isPending,
  });
};

const mode = (): HTMLSelectElement => screen.getByLabelText(`${KEY}.modeLabel`);
const save = (): HTMLElement => screen.getByRole('button', { name: `${KEY}.save` });
const days = (): HTMLInputElement => screen.getByLabelText(`${KEY}.daysLabel`);

/** A server 400, the shape `toFormError` turns into an inline message. */
const badRequest = (message: string): AxiosError =>
  new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { message },
  });

beforeEach(() => {
  vi.clearAllMocks();
  saving.value = false;
  setSaved(null);
});

describe('OrderDefaultsSection', () => {
  it('shimmers while the answer is on its way, then opens on the saved mode', () => {
    setSaved(null, true);
    const { rerender } = render(<OrderDefaultsSection />);
    expect(screen.queryByLabelText(`${KEY}.modeLabel`)).not.toBeInTheDocument();

    setSaved(null);
    rerender(<OrderDefaultsSection />);
    expect(mode().value).toBe('range');
    // Nothing changed yet — nothing to save.
    expect(save()).toBeDisabled();
  });

  it('opens a saved FIXED default on its number', () => {
    setSaved(2);
    render(<OrderDefaultsSection />);
    expect(mode().value).toBe('fixed');
    expect(days().value).toBe('2');
    expect(save()).toBeDisabled();
  });

  it('saves a fixed number, and toasts once the server agrees', async () => {
    updatePreferences.mockImplementation((_prefs, options: { onSuccess: () => void }) => options.onSuccess());
    render(<OrderDefaultsSection />);
    await userEvent.selectOptions(mode(), 'fixed');
    await userEvent.clear(days());
    await userEvent.type(days(), '3{Enter}');
    expect(updatePreferences).toHaveBeenCalledWith({ orderBilledDays: 3 }, expect.any(Object));
    expect(notify.success).toHaveBeenCalledWith(`${KEY}.saved`);
  });

  it('goes back to "by the dates" by saving null', async () => {
    setSaved(4);
    render(<OrderDefaultsSection />);
    await userEvent.selectOptions(mode(), 'range');
    await userEvent.click(save());
    expect(updatePreferences).toHaveBeenCalledWith({ orderBilledDays: null }, expect.any(Object));
  });

  it('refuses a number outside 1..365 inline, and clears the message once the admin edits', async () => {
    render(<OrderDefaultsSection />);
    await userEvent.selectOptions(mode(), 'fixed');
    await userEvent.clear(days());
    await userEvent.type(days(), '0{Enter}');
    expect(updatePreferences).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(`${KEY}.invalid`)).toBeInTheDocument());

    await userEvent.type(days(), '5');
    // Switching the mode also clears it.
    await userEvent.selectOptions(mode(), 'range');
    await userEvent.selectOptions(mode(), 'fixed');
  });

  it('routes a save failure by CONCERN: a 400 inline, anything else as a toast', async () => {
    updatePreferences.mockImplementationOnce((_prefs, options: { onError: (e: unknown) => void }) =>
      options.onError(badRequest('Fuera de rango')),
    );
    render(<OrderDefaultsSection />);
    await userEvent.selectOptions(mode(), 'fixed');
    await userEvent.click(save());
    await waitFor(() => expect(screen.getByText('Fuera de rango')).toBeInTheDocument());

    updatePreferences.mockImplementationOnce((_prefs, options: { onError: (e: unknown) => void }) =>
      options.onError(new Error('offline')),
    );
    await userEvent.click(save());
    expect(notify.error).toHaveBeenCalled();
  });

  it('sends nothing when the form is submitted on what is already saved', () => {
    // The disabled Save button already blocks Enter's implicit submission; the guard is for any
    // other path that submits the form.
    setSaved(2);
    render(<OrderDefaultsSection />);
    fireEvent.submit(days().closest('form') as HTMLFormElement);
    expect(updatePreferences).not.toHaveBeenCalled();
  });

  it('ignores a second save while one is in flight', async () => {
    saving.value = true;
    render(<OrderDefaultsSection />);
    await userEvent.selectOptions(mode(), 'fixed');
    await userEvent.type(days(), '{Enter}');
    expect(updatePreferences).not.toHaveBeenCalled();
  });
});
