import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { zodResolver } from '@hookform/resolvers/zod';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import ImageSelectForm from './ImageSelectForm';

const OPTIONS = [
  { value: 1, label: 'Mesas', imageUrl: 'https://cdn/mesa.webp' },
  { value: 2, label: 'Sillas' },
];

const schema = z.object({ productId: z.number({ error: 'requerido' }) });
type Form = z.infer<typeof schema>;

const Harness: React.FC<{ defaultProduct?: number | null; onValues?: (values: Form) => void }> = ({
  defaultProduct,
  onValues,
}) => {
  const methods = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { productId: defaultProduct as never },
    mode: 'onTouched',
  });
  const values = useWatch({ control: methods.control });
  onValues?.(values as Form);
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(() => {})}>
        <ImageSelectForm<Form>
          id="product"
          name="productId"
          label="Producto"
          placeholderOption="Selecciona"
          instructions="Elige uno"
          options={OPTIONS}
        />
        <button type="submit">enviar</button>
      </form>
    </FormProvider>
  );
};

const field = () => screen.getByRole('combobox');
const list = () => document.getElementById(field().getAttribute('aria-controls') as string) as HTMLElement;
const pick = async (name: string) => {
  await userEvent.click(field());
  await userEvent.click(within(list()).getByRole('option', { name }));
};

describe('ImageSelectForm', () => {
  it('stores the picked row as a NUMBER, and the "nothing" row as null', async () => {
    let latest: Form | undefined;
    render(<Harness onValues={(values) => (latest = values)} />);
    await pick('Sillas');
    await waitFor(() => expect(latest?.productId).toBe(2));
    await pick('Selecciona');
    await waitFor(() => expect(latest?.productId).toBeNull());
  });

  it('renders a stored value as the picked row', () => {
    render(<Harness defaultProduct={1} />);
    expect(field()).toHaveTextContent('Mesas');
  });

  it('surfaces the error only after a GENUINE engagement + leaving the field', async () => {
    render(<Harness />);
    fireEvent.blur(field()); // programmatic — no engagement
    await waitFor(() => expect(field()).not.toHaveAttribute('aria-invalid'));
    fireEvent.keyDown(field(), { key: 'ArrowDown' }); // engage (opens)
    fireEvent.blur(field());
    await waitFor(() => expect(field()).toHaveAttribute('aria-invalid', 'true'));
  });

  it('a pick commits touched at once, but only when the user engaged', async () => {
    render(<Harness defaultProduct={1} />);
    // Opened, cleared and left without a pointer press or key on the field (programmatic):
    fireEvent.click(field());
    fireEvent.click(within(list()).getByRole('option', { name: 'Selecciona' }));
    fireEvent.blur(field());
    // …the value changes and the form knows it is invalid, but the user never engaged: quiet.
    await waitFor(() => expect(field()).toHaveTextContent('Selecciona'));
    expect(field()).not.toHaveAttribute('aria-invalid');
    // A GENUINE pick of the empty row reveals the error at once — no need to leave the field.
    await pick('Mesas');
    await pick('Selecciona');
    await waitFor(() => expect(field()).toHaveAttribute('aria-invalid', 'true'));
  });

  it('reveals the error after a submit attempt, and marks the field required by pattern', async () => {
    const value = { requiredPatterns: [/^productId$/] };
    render(
      <RequiredPatternsContext.Provider value={value}>
        <Harness />
      </RequiredPatternsContext.Provider>,
    );
    expect(field()).toHaveAttribute('aria-required', 'true');
    expect(field()).toHaveAttribute('aria-describedby', 'productId-message');
    await userEvent.click(screen.getByRole('button', { name: 'enviar' }));
    await waitFor(() => expect(field()).toHaveAttribute('aria-invalid', 'true'));
  });
});
