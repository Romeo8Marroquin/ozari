import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CustomSelect from './CustomSelect';

const OPTIONS = [
  { value: 1, label: 'Alquiler' },
  { value: 2, label: 'Venta' },
];

describe('CustomSelect', () => {
  it('renders a labelled native select with its options', () => {
    render(<CustomSelect id="bt" label="Tipo" options={OPTIONS} value="1" onChange={() => {}} />);
    const select = screen.getByLabelText(/Tipo/);
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Alquiler' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Venta' })).toBeInTheDocument();
  });

  it('renders the placeholder option and starts unfilled', () => {
    render(
      <CustomSelect
        id="cat"
        label="Categoría"
        options={OPTIONS}
        placeholderOption="Selecciona"
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('option', { name: 'Selecciona' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Categoría/)).toHaveValue('');
  });

  it('fires onChange and marks itself filled after a selection', async () => {
    const onChange = vi.fn();
    render(<CustomSelect id="bt" label="Tipo" options={OPTIONS} defaultValue="" onChange={onChange} placeholderOption="—" />);
    await userEvent.selectOptions(screen.getByLabelText(/Tipo/), '2');
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByLabelText(/Tipo/)).toHaveValue('2');
  });

  it('exposes error and required state to assistive tech', () => {
    render(
      <CustomSelect id="bt" label="Tipo" options={OPTIONS} value="1" onChange={() => {}} error isRequired />,
    );
    const select = screen.getByLabelText(/Tipo/);
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-required', 'true');
  });

  it('shows the optional marker when flagged optional', () => {
    render(
      <CustomSelect id="bt" label="Tipo" options={OPTIONS} value="1" onChange={() => {}} optionalLabel />,
    );
    expect(screen.getByText('components.customInput.optionalField')).toBeInTheDocument();
  });

  it('can be disabled', () => {
    render(<CustomSelect id="bt" label="Tipo" options={OPTIONS} value="1" onChange={() => {}} disabled />);
    expect(screen.getByLabelText(/Tipo/)).toBeDisabled();
  });
});
