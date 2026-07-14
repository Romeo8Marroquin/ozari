import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CustomSelect from './CustomSelect';

/** Whether the floating label is in its floated (raised) position. */
const isLabelFloated = (container: HTMLElement): boolean =>
  (container.querySelector('label')?.className ?? '').split(/\s+/).includes('-translate-y-6');

const chevron = (container: HTMLElement): SVGElement =>
  container.querySelector('svg') as SVGElement;

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

  it('drops the floating label when a controlled value is RESET to empty (discard-draft path)', () => {
    const props = { id: 'bt', label: 'Tipo', options: OPTIONS, placeholderOption: '—', onChange: () => {} };
    const { rerender, container } = render(<CustomSelect {...props} value="2" />);
    expect(isLabelFloated(container)).toBe(true);

    // Fire a change first so the stale-internal-state trap would have been armed…
    fireEvent.change(screen.getByLabelText(/Tipo/), { target: { value: '1' } });
    // …then a programmatic reset (RHF reset()) clears the value WITHOUT another change event.
    rerender(<CustomSelect {...props} value="" />);
    expect(isLabelFloated(container)).toBe(false);
  });

  it('tracks fill via its own change events when UNcontrolled', async () => {
    const { container } = render(
      <CustomSelect id="bt" label="Tipo" options={OPTIONS} defaultValue="" placeholderOption="—" />,
    );
    expect(isLabelFloated(container)).toBe(false);
    await userEvent.selectOptions(screen.getByLabelText(/Tipo/), '2');
    expect(isLabelFloated(container)).toBe(true);
  });

  describe('chevron open/close rotation', () => {
    const renderSelect = () =>
      render(
        <CustomSelect id="bt" label="Tipo" options={OPTIONS} value="1" onChange={() => {}} />,
      );

    it('rotates on pointer open, toggles back on a second click', () => {
      const { container } = renderSelect();
      const select = screen.getByLabelText(/Tipo/);

      fireEvent.pointerDown(select);
      expect(chevron(container).getAttribute('class')).toContain('rotate-180');

      fireEvent.pointerDown(select);
      expect(chevron(container).getAttribute('class')).toContain('rotate-0');
    });

    it('rotates on the platform keyboard open gestures and settles on Escape', () => {
      const { container } = renderSelect();
      const select = screen.getByLabelText(/Tipo/);

      for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
        fireEvent.keyDown(select, { key: 'Escape' }); // settle
        expect(chevron(container).getAttribute('class')).toContain('rotate-0');
        fireEvent.keyDown(select, { key });
        expect(chevron(container).getAttribute('class')).toContain('rotate-180');
      }

      // An unrelated key changes nothing.
      fireEvent.keyDown(select, { key: 'a' });
      expect(chevron(container).getAttribute('class')).toContain('rotate-180');
    });

    it('settles the chevron on selection and on blur (click-outside)', () => {
      const { container } = renderSelect();
      const select = screen.getByLabelText(/Tipo/);

      fireEvent.pointerDown(select);
      fireEvent.change(select, { target: { value: '2' } });
      expect(chevron(container).getAttribute('class')).toContain('rotate-0');

      fireEvent.pointerDown(select);
      fireEvent.blur(select);
      expect(chevron(container).getAttribute('class')).toContain('rotate-0');
    });

    it('never rotates while disabled', () => {
      const { container } = render(
        <CustomSelect id="bt" label="Tipo" options={OPTIONS} value="1" onChange={() => {}} disabled />,
      );
      fireEvent.pointerDown(screen.getByLabelText(/Tipo/));
      expect(chevron(container).getAttribute('class')).toContain('rotate-0');
    });

    it('still forwards the caller’s pointer/key/blur handlers', () => {
      const onPointerDown = vi.fn();
      const onKeyDown = vi.fn();
      const onBlur = vi.fn();
      render(
        <CustomSelect
          id="bt"
          label="Tipo"
          options={OPTIONS}
          value="1"
          onChange={() => {}}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />,
      );
      const select = screen.getByLabelText(/Tipo/);
      fireEvent.pointerDown(select);
      fireEvent.keyDown(select, { key: 'Enter' });
      fireEvent.blur(select);
      expect(onPointerDown).toHaveBeenCalled();
      expect(onKeyDown).toHaveBeenCalled();
      expect(onBlur).toHaveBeenCalled();
    });
  });
});
