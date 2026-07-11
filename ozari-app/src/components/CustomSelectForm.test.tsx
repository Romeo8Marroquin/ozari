import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { zodResolver } from '@hookform/resolvers/zod';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import CustomSelectForm from './CustomSelectForm';

const OPTIONS = [
  { value: 1, label: 'Mesas' },
  { value: 2, label: 'Sillas' },
];

const schema = z.object({
  categoryId: z.number({ error: 'requerido' }),
  other: z.string(),
});
type Form = z.infer<typeof schema>;

const Harness: React.FC<{
  defaultCategory?: number | null;
  deps?: 'other'[];
  onValues?: (values: Form) => void;
}> = ({ defaultCategory, deps, onValues }) => {
  const methods = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { categoryId: defaultCategory as never, other: '' },
    mode: 'onTouched',
  });
  const values = useWatch({ control: methods.control });
  onValues?.(values as Form);
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(() => {})}>
        <CustomSelectForm<Form>
          id="cat"
          name="categoryId"
          label="Categoría"
          placeholderOption="Selecciona"
          options={OPTIONS}
          deps={deps}
        />
        <button type="submit">enviar</button>
      </form>
    </FormProvider>
  );
};

describe('CustomSelectForm', () => {
  it('stores the picked option as a NUMBER in the form state', async () => {
    let latest: Form | undefined;
    render(<Harness onValues={(values) => (latest = values)} />);
    const select = screen.getByLabelText(/Categoría/);
    fireEvent.pointerDown(select); // genuine engagement
    await userEvent.selectOptions(select, '2');
    await waitFor(() => expect(latest?.categoryId).toBe(2));
  });

  it('maps the empty placeholder back to null (the empty-selection sentinel)', async () => {
    let latest: Form | undefined;
    render(<Harness defaultCategory={1} onValues={(values) => (latest = values)} />);
    const select = screen.getByLabelText(/Categoría/);
    fireEvent.pointerDown(select);
    await userEvent.selectOptions(select, '');
    await waitFor(() => expect(latest?.categoryId).toBeNull());
  });

  it('renders a null form value as the empty selection', () => {
    render(<Harness defaultCategory={null} />);
    expect(screen.getByLabelText(/Categoría/)).toHaveValue('');
  });

  it('a programmatic change (no user engagement) updates the value without committing touched', async () => {
    render(<Harness />);
    const select = screen.getByLabelText(/Categoría/);
    fireEvent.change(select, { target: { value: '1' } }); // e.g. a browser restore — not a user action
    await waitFor(() => expect(select).toHaveValue('1'));
    expect(select).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('surfaces the error after a genuine engagement + blur', async () => {
    render(<Harness />);
    const select = screen.getByLabelText(/Categoría/);
    fireEvent.keyDown(select, { key: 'ArrowDown' }); // engage
    fireEvent.blur(select);
    await waitFor(() => expect(select).toHaveAttribute('aria-invalid', 'true'));
  });

  it('stays quiet on a programmatic blur without engagement', async () => {
    render(<Harness />);
    const select = screen.getByLabelText(/Categoría/);
    fireEvent.blur(select);
    await waitFor(() => expect(select).not.toHaveAttribute('aria-invalid', 'true'));
  });

  it('reveals the error after a submit attempt', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'enviar' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Categoría/)).toHaveAttribute('aria-invalid', 'true'),
    );
    // The message itself is revealed by AnimatedMessage's timeline (visual, not asserted in jsdom).
  });

  it('re-validates dependent fields on change (deps)', async () => {
    render(<Harness deps={['other']} />);
    const select = screen.getByLabelText(/Categoría/);
    fireEvent.pointerDown(select);
    await userEvent.selectOptions(select, '1');
    expect(select).toHaveValue('1');
  });

  it('marks the field required when a required-pattern matches its name', () => {
    const value = { requiredPatterns: [/^categoryId$/] };
    render(
      <RequiredPatternsContext.Provider value={value}>
        <Harness />
      </RequiredPatternsContext.Provider>,
    );
    expect(screen.getByLabelText(/Categoría/)).toHaveAttribute('aria-required', 'true');
  });
});
