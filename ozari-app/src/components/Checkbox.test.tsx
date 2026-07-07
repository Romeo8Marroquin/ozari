import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Checkbox from './Checkbox';

describe('Checkbox', () => {
  it('renders a labelled checkbox and toggles on click', async () => {
    render(<Checkbox label="Acepto los términos" />);
    const box = screen.getByRole('checkbox');
    expect(screen.getByText('Acepto los términos')).toBeInTheDocument();
    expect(box).not.toBeChecked();

    await userEvent.click(box);
    expect(box).toBeChecked();
  });

  it('fires onChange with the checked state', async () => {
    const onChange = vi.fn();
    render(<Checkbox onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalled();
  });

  it('honours disabled', () => {
    render(<Checkbox disabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
