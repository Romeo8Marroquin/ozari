import { zodResolver } from '@hookform/resolvers/zod';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import MfaCodeField, { type MfaCodeMode } from './MfaCodeField';

const schema = z.object({ code: z.string().regex(/^\d{6}$/, 'too-short') });
type FormT = z.infer<typeof schema>;

const Harness: React.FC<{
  autoFocus?: boolean;
  disabled?: boolean;
  mode?: MfaCodeMode;
  maxLength?: number;
  onComplete?: () => void;
}> = ({ autoFocus, disabled, mode, maxLength, onComplete }) => {
  const methods = useForm<FormT>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
    mode: 'onTouched',
  });
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(() => {})}>
        <MfaCodeField<FormT>
          name="code"
          label="Code"
          mode={mode}
          maxLength={maxLength}
          autoFocus={autoFocus}
          disabled={disabled}
          onComplete={onComplete}
        />
        <button type="submit">submit</button>
      </form>
    </FormProvider>
  );
};

describe('MfaCodeField', () => {
  it('renders the label and a numeric one-time-code input (required)', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('maxlength', '6');
    expect(input).toHaveAttribute('aria-required', 'true');
  });

  it('strips non-digit characters as the user types (numeric mode)', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('Code') as HTMLInputElement;
    await userEvent.type(input, 'a1b2c3');
    expect(input.value).toBe('123');
  });

  it('shows the inline error only after a submit attempt', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('Code');
    expect(input).not.toHaveAttribute('aria-invalid');

    await userEvent.click(screen.getByRole('button', { name: 'submit' }));
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(await screen.findByText('too-short')).toBeInTheDocument();
  });

  it('honours autoFocus (modal autofocus hook) and disabled', () => {
    const { rerender } = render(<Harness autoFocus />);
    expect(screen.getByLabelText('Code')).toHaveAttribute('data-modal-autofocus');

    rerender(<Harness disabled />);
    expect(screen.getByLabelText('Code')).toBeDisabled();
  });

  it('fires onComplete on a bulk fill (paste/autofill), but not while typing', async () => {
    const onComplete = vi.fn();
    const { unmount } = render(<Harness onComplete={onComplete} />);
    const input = screen.getByLabelText('Code') as HTMLInputElement;

    // A paste / password-manager autofill arrives as one multi-char change that completes the code.
    fireEvent.change(input, { target: { value: '123456' } });
    expect(onComplete).toHaveBeenCalledTimes(1);

    unmount();
    onComplete.mockClear();
    render(<Harness onComplete={onComplete} />);
    // Typing digit-by-digit never bulk-completes.
    await userEvent.type(screen.getByLabelText('Code'), '123456');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('accepts an alphanumeric recovery code in text mode and never auto-completes', () => {
    const onComplete = vi.fn();
    render(<Harness mode="text" maxLength={16} onComplete={onComplete} />);
    const input = screen.getByLabelText('Code') as HTMLInputElement;
    expect(input).toHaveAttribute('inputmode', 'text');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('maxlength', '16');

    // Upper-cases and strips separators; a bulk fill in text mode does NOT auto-submit.
    fireEvent.change(input, { target: { value: 'abcd-2345-efgh-6789' } });
    expect(input.value).toBe('ABCD2345EFGH6789');
    expect(onComplete).not.toHaveBeenCalled();
  });
});
