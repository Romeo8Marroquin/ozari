import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LocationField from './LocationField';

// The picker is exercised by its own suite; here it is stubbed down to the one thing this component
// cares about — that opening it and confirming hands a pin back to the form.
vi.mock('./LocationPicker', () => ({
  default: ({
    open,
    onConfirm,
    onClose,
  }: {
    open: boolean;
    onConfirm: (coords: { lat: number; lng: number }) => void;
    onClose: () => void;
  }) =>
    open ? (
      <>
        <button type="button" onClick={() => onConfirm({ lat: 14.6, lng: -90.5 })}>
          confirm-stub
        </button>
        <button type="button" onClick={onClose}>
          close-stub
        </button>
      </>
    ) : null,
}));

const KEY = 'components.locationField';

describe('LocationField', () => {
  it('says NO PIN plainly — an address without one is a finished address', async () => {
    render(<LocationField id="test" value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText(`${KEY}.empty`)).toBeInTheDocument();
    // Nothing to clear when there is nothing set.
    expect(screen.queryByTestId('test-clear')).not.toBeInTheDocument();
  });

  it('opens the picker and stores what it returns', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LocationField id="test" value={undefined} onChange={onChange} />);

    // Nothing of the picker exists until it is asked for — the map library is lazily loaded.
    expect(screen.queryByRole('button', { name: 'confirm-stub' })).not.toBeInTheDocument();

    await user.click(screen.getByTestId('test-open'));
    await user.click(await screen.findByRole('button', { name: 'confirm-stub' }));
    expect(onChange).toHaveBeenCalledWith({ lat: 14.6, lng: -90.5 });
  });

  it('keeps what it had when the picker is dismissed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LocationField id="test" value={undefined} onChange={onChange} />);

    await user.click(screen.getByTestId('test-open'));
    await user.click(await screen.findByRole('button', { name: 'close-stub' }));
    // Closing is not a decision: nothing is written, and the dialog unmounts.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'confirm-stub' })).not.toBeInTheDocument();
  });

  it('shows the pin and lets it be REMOVED — a wrong pin is worse than none', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LocationField id="test" value={{ lat: 14.634915, lng: -90.506883 }} onChange={onChange} />);

    expect(screen.getByText('14.634915, -90.506883')).toBeInTheDocument();
    await user.click(screen.getByTestId('test-clear'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
