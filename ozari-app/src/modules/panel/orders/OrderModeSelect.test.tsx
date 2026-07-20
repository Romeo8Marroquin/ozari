import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import OrderModeSelect from './OrderModeSelect';
import type { OrderMode } from './SchemaCreateOrder';

/** A controlled harness so a selection actually moves the value (the real form re-renders). */
const Controlled: React.FC<{ initial?: OrderMode; onSelect: (m: OrderMode) => void; disabled?: boolean }> = ({
  initial = 'rent',
  onSelect,
  disabled,
}) => {
  const [value, setValue] = useState<OrderMode>(initial);
  return (
    <OrderModeSelect
      value={value}
      disabled={disabled}
      onChange={(mode) => {
        onSelect(mode);
        setValue(mode);
      }}
    />
  );
};

const setup = (initial: OrderMode = 'rent', disabled = false) => {
  const onSelect = vi.fn();
  render(<Controlled initial={initial} onSelect={onSelect} disabled={disabled} />);
  return { onSelect, radios: () => screen.getAllByRole('radio') };
};

describe('OrderModeSelect', () => {
  it('renders a radiogroup of three with roving tabindex', () => {
    const { radios } = setup();
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('modules.panel.orders.create.mode.label');
    expect(radios()).toHaveLength(3);
    expect(radios()[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios()[0]).toHaveAttribute('tabindex', '0');
    expect(radios()[1]).toHaveAttribute('tabindex', '-1');
  });

  it('clicking an unchecked option selects it; the checked one is a no-op', async () => {
    const user = userEvent.setup();
    const { onSelect, radios } = setup();
    await user.click(radios()[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('buy');
    onSelect.mockClear();
    await user.click(radios()[1] as HTMLElement); // now 'buy' is checked
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('arrow keys move-and-select across the group and wrap', async () => {
    const user = userEvent.setup();
    const { onSelect, radios } = setup();
    (radios()[0] as HTMLElement).focus();
    await user.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenLastCalledWith('buy');
    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenLastCalledWith('both');
    await user.keyboard('{ArrowRight}'); // wraps
    expect(onSelect).toHaveBeenLastCalledWith('rent');
    await user.keyboard('{ArrowLeft}'); // wraps back
    expect(onSelect).toHaveBeenLastCalledWith('both');
  });

  it('Home/End jump to the ends; other keys pass through', async () => {
    const user = userEvent.setup();
    const { onSelect, radios } = setup('both');
    (radios()[2] as HTMLElement).focus();
    await user.keyboard('{Home}');
    expect(onSelect).toHaveBeenLastCalledWith('rent');
    await user.keyboard('{End}');
    expect(onSelect).toHaveBeenLastCalledWith('both');
    onSelect.mockClear();
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('honors the disabled state', () => {
    const { radios } = setup('rent', true);
    radios().forEach((radio) => expect(radio).toBeDisabled());
  });
});
