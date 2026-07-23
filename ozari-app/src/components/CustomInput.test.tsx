import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import gsap from 'gsap';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomInput from './CustomInput';

// Advance GSAP's clock so mid-timeline callbacks (the password-flip's `.add`) fire.
const advanceGsap = (): void => act(() => gsap.updateRoot(gsap.globalTimeline.time() + 1));
afterEach(() => gsap.globalTimeline.clear());

describe('CustomInput', () => {
  it('renders a labelled text input and forwards onChange', async () => {
    const onChange = vi.fn();
    render(<CustomInput id="email" label="Correo" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'a');
    expect(onChange).toHaveBeenCalled();
  });

  it('reflects the error state as aria-invalid', () => {
    render(<CustomInput id="e" label="Correo" error />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('reflects the required state as aria-required and shows the marker', () => {
    render(<CustomInput id="e" label="Correo" isRequired />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByText('components.customInput.requiredField')).toBeInTheDocument();
  });

  it('shows an optional label when marked optional', () => {
    render(<CustomInput id="e" label="Teléfono" optionalLabel />);
    expect(screen.getByText('components.customInput.optionalField')).toBeInTheDocument();
  });

  it('renders a labelled show/hide toggle for password inputs', () => {
    render(<CustomInput id="p" label="Contraseña" type="password" />);
    expect(
      screen.getByRole('button', { name: 'components.customInput.showPassword' }),
    ).toBeInTheDocument();
  });

  it('invokes onIconClick for a non-password action icon', () => {
    const onIconClick = vi.fn();
    render(<CustomInput id="s" label="Buscar" icon={<span data-testid="icon" />} onIconClick={onIconClick} />);
    fireEvent.mouseDown(screen.getByRole('button'));
    expect(onIconClick).toHaveBeenCalledTimes(1);
  });

  it('toggles password visibility on the icon click (via the GSAP flip)', () => {
    render(<CustomInput id="p" label="Contraseña" type="password" />);
    const input = document.querySelector('input') as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: 'components.customInput.showPassword' });
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.mouseDown(toggle);
    advanceGsap();
    expect(input).toHaveAttribute('type', 'text');
  });

  it('toggles password visibility via the keyboard (Space), ignoring other keys', () => {
    render(<CustomInput id="p" label="Contraseña" type="password" />);
    const input = document.querySelector('input') as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: 'components.customInput.showPassword' });

    fireEvent.keyDown(toggle, { key: 'a' }); // ignored
    advanceGsap();
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.keyDown(toggle, { key: ' ' });
    advanceGsap();
    expect(input).toHaveAttribute('type', 'text');
  });

  it('toggles password visibility via the keyboard (Enter)', () => {
    render(<CustomInput id="p" label="Contraseña" type="password" />);
    const input = document.querySelector('input') as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: 'components.customInput.showPassword' });

    fireEvent.keyDown(toggle, { key: 'Enter' });
    advanceGsap();
    expect(input).toHaveAttribute('type', 'text');
  });

  it('does not toggle a disabled password field', () => {
    render(<CustomInput id="p" label="Contraseña" type="password" disabled />);
    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.mouseDown(screen.getByRole('button'));
    advanceGsap();
    expect(input).toHaveAttribute('type', 'password'); // unchanged — the disabled guard returns early
  });

  it('hides a native date/time picker format hint until focus/value, then shows the value', () => {
    const classesOf = (c: HTMLElement) =>
      ((c.querySelector('input') as HTMLInputElement).className ?? '').split(/\s+/);
    const { container, rerender } = render(
      <CustomInput id="d" label="Entrega" type="datetime-local" value="" onChange={() => {}} />,
    );
    // Empty → the format text is transparent (unfocused) and a soft gray on focus (placeholder-like).
    expect(classesOf(container)).toContain('text-transparent');
    expect(classesOf(container)).toContain('focus:text-charcoal/45');
    // Filled → the value shows in the normal color (no transparent).
    rerender(
      <CustomInput id="d" label="Entrega" type="datetime-local" value="2026-08-01T14:00" onChange={() => {}} />,
    );
    expect(classesOf(container)).not.toContain('text-transparent');
  });

  it('a native picker in error keeps the hint hidden but reveals it red on focus', () => {
    const input = (
      render(<CustomInput id="d" label="Entrega" type="datetime-local" value="" error onChange={() => {}} />)
        .container.querySelector('input') as HTMLInputElement
    ).className;
    expect(input.split(/\s+/)).toContain('text-transparent');
    expect(input).toContain('focus:text-red-600');
  });

  it('leaves a plain text input untouched (no transparent-text trick)', () => {
    const input = (
      render(<CustomInput id="t" label="Nombre" type="text" value="" onChange={() => {}} />)
        .container.querySelector('input') as HTMLInputElement
    ).className;
    expect(input.split(/\s+/)).not.toContain('text-transparent');
  });

  it('drops the floating label when a controlled value is RESET to empty (discard-draft path)', () => {
    const isLabelFloated = (container: HTMLElement): boolean =>
      (container.querySelector('label')?.className ?? '').split(/\s+/).includes('-translate-y-6');

    const { rerender, container } = render(
      <CustomInput id="n" label="Nombre" value="Test" onChange={() => {}} />,
    );
    expect(isLabelFloated(container)).toBe(true);

    // Arm the old stale-state trap (a change fires), then reset programmatically (no change event).
    fireEvent.change(container.querySelector('input') as HTMLInputElement, {
      target: { value: 'Test 2' },
    });
    rerender(<CustomInput id="n" label="Nombre" value="" onChange={() => {}} />);
    expect(isLabelFloated(container)).toBe(false);
  });
});
