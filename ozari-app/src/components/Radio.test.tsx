import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Radio from './Radio';

describe('Radio', () => {
  it('renders a labelled radio and fires onChange when selected', async () => {
    const onChange = vi.fn();
    render(<Radio name="group" label="Principal" checked={false} onChange={onChange} />);
    const radio = screen.getByRole('radio', { name: 'Principal' });
    expect(radio).not.toBeChecked();
    await userEvent.click(radio);
    expect(onChange).toHaveBeenCalled();
  });

  it('reflects the checked state with a custom color', () => {
    render(<Radio label="Favorita" defaultChecked color="#123456" />);
    expect(screen.getByRole('radio', { name: 'Favorita' })).toBeChecked();
  });

  it('supports a disabled, label-less radio', () => {
    render(<Radio aria-label="bare" disabled />);
    const radio = screen.getByRole('radio', { name: 'bare' });
    expect(radio).toBeDisabled();
  });
});
