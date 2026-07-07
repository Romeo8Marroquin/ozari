import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Button from './Button';

describe('Button', () => {
  it('renders its label and defaults to type="button"', () => {
    render(<Button>Guardar</Button>);
    const button = screen.getByRole('button', { name: 'Guardar' });
    expect(button).toHaveAttribute('type', 'button');
  });

  it('fires onClick when enabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ir</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Ir
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('while loading: aria-busy, disabled, and no click-through', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Enviar
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders start/end icons', () => {
    render(
      <Button startIcon={<span data-testid="start" />} endIcon={<span data-testid="end" />}>
        X
      </Button>,
    );
    expect(screen.getByTestId('start')).toBeInTheDocument();
    expect(screen.getByTestId('end')).toBeInTheDocument();
  });

  it('renders a fully-rounded pill when pill is set', () => {
    render(<Button pill>Pill</Button>);
    expect(screen.getByRole('button')).toHaveClass('rounded-full');
  });
});
