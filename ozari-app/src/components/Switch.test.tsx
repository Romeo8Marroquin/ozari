import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Switch from './Switch';

describe('Switch', () => {
  it('renders an accessible, checked switch with a label and explicit id/color', () => {
    render(<Switch checked label="MFA" aria-label="mfa" color="#123456" id="sw" />);
    const input = screen.getByRole('switch');
    expect(input).toBeChecked();
    expect(input).toHaveAttribute('id', 'sw');
    expect(input).toHaveAccessibleName('mfa');
    expect(screen.getByText('MFA')).toBeInTheDocument();
  });

  it('reports the requested next state through onChange when toggled', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="mfa" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is inert when disabled — no toggle, no onChange', async () => {
    const onChange = vi.fn();
    render(<Switch checked disabled onChange={onChange} aria-label="mfa" />);
    const input = screen.getByRole('switch');
    expect(input).toBeDisabled();
    await userEvent.click(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('tolerates a toggle with no onChange handler wired', async () => {
    // A read-only status switch (no handler) must not throw when activated.
    render(<Switch checked={false} readOnly aria-label="mfa" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });
});
