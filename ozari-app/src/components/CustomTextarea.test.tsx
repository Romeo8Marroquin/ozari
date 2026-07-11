import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CustomTextarea from './CustomTextarea';

describe('CustomTextarea', () => {
  it('renders a labelled textarea', () => {
    render(<CustomTextarea id="desc" label="Descripción" />);
    const textarea = screen.getByLabelText(/Descripción/);
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('fires onChange and tracks the filled state', async () => {
    const onChange = vi.fn();
    render(<CustomTextarea id="desc" label="Descripción" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/Descripción/), 'Hola');
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByLabelText(/Descripción/)).toHaveValue('Hola');
  });

  it('starts filled when a value is provided', () => {
    render(<CustomTextarea id="desc" label="Descripción" value="texto" onChange={() => {}} />);
    expect(screen.getByLabelText(/Descripción/)).toHaveValue('texto');
  });

  it('exposes error and required state to assistive tech', () => {
    render(<CustomTextarea id="desc" label="Descripción" error isRequired />);
    const textarea = screen.getByLabelText(/Descripción/);
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAttribute('aria-required', 'true');
  });

  it('shows the optional marker when flagged optional', () => {
    render(<CustomTextarea id="desc" label="Descripción" optionalLabel />);
    expect(screen.getByText('components.customInput.optionalField')).toBeInTheDocument();
  });

  it('can be disabled', () => {
    render(<CustomTextarea id="desc" label="Descripción" disabled />);
    expect(screen.getByLabelText(/Descripción/)).toBeDisabled();
  });
});
