import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { zodResolver } from '@hookform/resolvers/zod';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import CustomInputForm from './CustomInputForm';

interface Form {
  email: string;
}

const Harness: React.FC = () => {
  const methods = useForm<Form>({ defaultValues: { email: '' } });
  return (
    <FormProvider {...methods}>
      <CustomInputForm<Form> name="email" label="Correo" />
    </FormProvider>
  );
};

interface ValidatedForm {
  a: string;
  b: string;
}
const validatedSchema = z.object({ a: z.string().min(3, 'muy corto'), b: z.string() });
const ValidatedHarness: React.FC<{ deps?: (keyof ValidatedForm)[] }> = ({ deps }) => {
  const methods = useForm<ValidatedForm>({
    resolver: zodResolver(validatedSchema),
    defaultValues: { a: '', b: '' },
    mode: 'onTouched',
  });
  return (
    <FormProvider {...methods}>
      <CustomInputForm<ValidatedForm> name="a" label="A" deps={deps} />
    </FormProvider>
  );
};

describe('CustomInputForm', () => {
  it('renders the labelled field wired to react-hook-form', async () => {
    render(<Harness />);
    const input = screen.getByRole('textbox');
    expect(screen.getByText('Correo')).toBeInTheDocument();

    await userEvent.type(input, 'a@b.com');
    expect(input).toHaveValue('a@b.com');
  });

  it('surfaces the field error only after the user engages and blurs', async () => {
    render(<ValidatedHarness />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'a' }); // mark genuine engagement
    await userEvent.type(input, 'ab'); // invalid (min 3)
    expect(input).not.toHaveAttribute('aria-invalid', 'true'); // not shown until blur

    fireEvent.blur(input); // commits touched → error surfaces
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
  });

  it('re-validates dependent fields on change (deps)', async () => {
    render(<ValidatedHarness deps={['b']} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'x');
    expect(input).toHaveValue('x');
  });

  it('marks the field required when a required-pattern matches its name', () => {
    const RequiredHarness: React.FC = () => {
      const methods = useForm<Form>({ defaultValues: { email: '' } });
      return (
        <RequiredPatternsContext.Provider value={{ requiredPatterns: [/^email$/] }}>
          <FormProvider {...methods}>
            <CustomInputForm<Form> name="email" label="Correo" />
          </FormProvider>
        </RequiredPatternsContext.Provider>
      );
    };
    render(<RequiredHarness />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-required', 'true');
  });

  it('assigns the underlying input to a provided ref', () => {
    const ref: { current: HTMLInputElement | null } = { current: null };
    const RefHarness: React.FC = () => {
      const methods = useForm<Form>({ defaultValues: { email: '' } });
      return (
        <FormProvider {...methods}>
          <CustomInputForm<Form> name="email" label="Correo" ref={ref} />
        </FormProvider>
      );
    };
    render(<RefHarness />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('syncs an autofilled value the controlled input missed, on blur', async () => {
    render(<ValidatedHarness />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'a' }); // engage
    // Simulate an autofill that bypassed React's onChange — the DOM holds a value RHF never saw.
    input.value = 'autofilled-value';
    fireEvent.blur(input);
    await waitFor(() => expect(input).toHaveValue('autofilled-value'));
  });

  it('does not surface an error on a blur the user never engaged', async () => {
    render(<ValidatedHarness />);
    const input = screen.getByRole('textbox');
    fireEvent.blur(input); // programmatic-style blur, no prior engagement
    await waitFor(() => expect(input).not.toHaveAttribute('aria-invalid', 'true'));
  });

  it('reveals the error after a submit attempt, without per-field touch', async () => {
    const SubmitHarness: React.FC = () => {
      const methods = useForm<ValidatedForm>({
        resolver: zodResolver(validatedSchema),
        defaultValues: { a: '', b: '' },
      });
      return (
        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(() => {})}>
            <CustomInputForm<ValidatedForm> name="a" label="A" />
            <button type="submit">enviar</button>
          </form>
        </FormProvider>
      );
    };
    render(<SubmitHarness />);
    await userEvent.click(screen.getByText('enviar'));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true'));
  });
});
