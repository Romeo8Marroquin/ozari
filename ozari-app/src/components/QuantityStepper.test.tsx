import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import QuantityStepper from './QuantityStepper';

const K = 'components.quantityStepper';
const field = (): HTMLInputElement => screen.getByRole('textbox', { name: 'Cantidad' }) as HTMLInputElement;

describe('QuantityStepper', () => {
  it('steps by one each way, inside a named group', async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={3} max={5} onChange={onChange} label="Cantidad" />);
    expect(screen.getByRole('group', { name: 'Cantidad' })).toBeInTheDocument();
    expect(field().value).toBe('3');
    await userEvent.click(screen.getByRole('button', { name: `${K}.increase` }));
    expect(onChange).toHaveBeenLastCalledWith(4);
    await userEvent.click(screen.getByRole('button', { name: `${K}.decrease` }));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('turns the minus into "Quitar" at one unit — it takes the thing OUT (0)', async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={1} onChange={onChange} label="Cantidad" size="sm" />);
    await userEvent.click(screen.getByRole('button', { name: `${K}.remove` }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('stops the plus at the cap and says why; no cap means no stop', () => {
    const { rerender } = render(<QuantityStepper value={5} max={5} onChange={vi.fn()} label="Cantidad" />);
    expect(screen.getByRole('button', { name: `${K}.atMax` })).toBeDisabled();
    rerender(<QuantityStepper value={500} onChange={vi.fn()} label="Cantidad" />);
    expect(screen.getByRole('button', { name: `${K}.increase` })).toBeEnabled();
  });

  it('takes a TYPED amount on Enter or blur, clamped to the cap; digits only', async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={2} max={6} onChange={onChange} label="Cantidad" />);
    await userEvent.click(field());
    await userEvent.keyboard('{Control>}a{/Control}4x{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(4);
    await userEvent.clear(field());
    await userEvent.type(field(), '99');
    fireEvent.blur(field());
    expect(onChange).toHaveBeenLastCalledWith(6);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('puts the value back for an empty, zero or unchanged entry — removing is the trash can’s job', async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={2} onChange={onChange} label="Cantidad" />);
    await userEvent.clear(field());
    fireEvent.blur(field());
    expect(field().value).toBe('2');
    await userEvent.clear(field());
    await userEvent.type(field(), '0');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await userEvent.clear(field());
    await userEvent.type(field(), '2');
    fireEvent.blur(field());
    // A blur without typing (nothing being edited) is a no-op too, and other keys pass through.
    fireEvent.blur(field());
    fireEvent.keyDown(field(), { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a cap of ZERO still lets a typed amount fall back to one, never below', async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={3} max={0} onChange={onChange} label="Cantidad" autoFocus />);
    expect(field()).toHaveFocus();
    await userEvent.keyboard('{Control>}a{/Control}5{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
});
