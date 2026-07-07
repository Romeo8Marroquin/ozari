import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import MfaCodeField from './MfaCodeField';
import { mfaCodeDefaultValues, mfaCodeSchema, type MfaCodeType } from './SchemaMfaCode';

const KEY = 'modules.panel.settings.security.mfa.enable';

// A minimal RHF host mirroring how the enable modal uses the field (validated + submittable).
const Harness: React.FC<{ autoFocus?: boolean; disabled?: boolean }> = ({ autoFocus, disabled }) => {
  const methods = useForm<MfaCodeType>({
    resolver: zodResolver(mfaCodeSchema),
    defaultValues: mfaCodeDefaultValues,
    mode: 'onTouched',
  });
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(() => {})}>
        <MfaCodeField<MfaCodeType>
          name="code"
          label={`${KEY}.codeLabel`}
          autoFocus={autoFocus}
          disabled={disabled}
        />
        <button type="submit">submit</button>
      </form>
    </FormProvider>
  );
};

describe('MfaCodeField', () => {
  it('renders the label and a numeric one-time-code input', () => {
    render(<Harness />);
    const input = screen.getByLabelText(`${KEY}.codeLabel`);
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('maxlength', '6');
  });

  it('strips non-digit characters as the user types', async () => {
    render(<Harness />);
    const input = screen.getByLabelText(`${KEY}.codeLabel`) as HTMLInputElement;
    await userEvent.type(input, 'a1b2c3');
    expect(input.value).toBe('123');
  });

  it('shows the inline error only after a submit attempt', async () => {
    render(<Harness />);
    const input = screen.getByLabelText(`${KEY}.codeLabel`);
    expect(input).not.toHaveAttribute('aria-invalid');

    await userEvent.click(screen.getByRole('button', { name: 'submit' }));
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(await screen.findByText(`${KEY}.errors.codeLength`)).toBeInTheDocument();
  });

  it('honours autoFocus (modal autofocus hook) and disabled', () => {
    const { rerender } = render(<Harness autoFocus />);
    expect(screen.getByLabelText(`${KEY}.codeLabel`)).toHaveAttribute('data-modal-autofocus');

    rerender(<Harness disabled />);
    expect(screen.getByLabelText(`${KEY}.codeLabel`)).toBeDisabled();
  });
});
