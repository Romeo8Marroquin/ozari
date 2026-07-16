import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { zodResolver } from '@hookform/resolvers/zod';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import CustomTextareaForm from './CustomTextareaForm';

interface Form {
  description: string;
  other: string;
}

const schema = z.object({
  description: z.string().min(5, 'muy corto'),
  other: z.string(),
});

const Harness: React.FC<{ deps?: 'other'[] }> = ({ deps }) => {
  const methods = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { description: '', other: '' },
    mode: 'onTouched',
  });
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(() => {})}>
        <CustomTextareaForm<Form> id="desc" name="description" label="Descripción" deps={deps} />
        <button type="submit">enviar</button>
      </form>
    </FormProvider>
  );
};

describe('CustomTextareaForm', () => {
  it('renders the labelled textarea wired to react-hook-form', async () => {
    render(<Harness />);
    const textarea = screen.getByLabelText(/Descripción/);
    await userEvent.type(textarea, 'texto largo');
    expect(textarea).toHaveValue('texto largo');
  });

  it('surfaces the field error only after the user engages and blurs', async () => {
    render(<Harness />);
    const textarea = screen.getByLabelText(/Descripción/);

    fireEvent.keyDown(textarea, { key: 'a' }); // genuine engagement
    await userEvent.type(textarea, 'ab'); // invalid (min 5)
    expect(textarea).not.toHaveAttribute('aria-invalid', 'true');

    fireEvent.blur(textarea);
    await waitFor(() => expect(textarea).toHaveAttribute('aria-invalid', 'true'));
  });

  it('stays quiet on a programmatic blur without engagement', async () => {
    render(<Harness />);
    fireEvent.blur(screen.getByLabelText(/Descripción/));
    await waitFor(() =>
      expect(screen.getByLabelText(/Descripción/)).not.toHaveAttribute('aria-invalid', 'true'),
    );
  });

  it('reveals the error after a submit attempt', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'enviar' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Descripción/)).toHaveAttribute('aria-invalid', 'true'),
    );
  });

  it('re-validates dependent fields on change (deps)', async () => {
    render(<Harness deps={['other']} />);
    const textarea = screen.getByLabelText(/Descripción/);
    await userEvent.type(textarea, 'x');
    expect(textarea).toHaveValue('x');
  });

  it('marks the field required when a required-pattern matches its name', () => {
    render(
      <RequiredPatternsContext.Provider value={{ requiredPatterns: [/^description$/] }}>
        <Harness />
      </RequiredPatternsContext.Provider>,
    );
    expect(screen.getByLabelText(/Descripción/)).toHaveAttribute('aria-required', 'true');
  });
});
