import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

const Boom = (): never => {
  throw new Error('kaboom');
};

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>contenido</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });

  it('renders the on-brand crash screen when a child throws', () => {
    // React logs the caught error; silence it for a clean run.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    // ErrorScreen(crash) copy (i18n mock returns the key).
    expect(screen.getByText('errorScreen.crash.title')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('errorScreen.crash.action');
  });

  it('reloads the app when the recovery button is pressed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { reload } });

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(reload).toHaveBeenCalled();

    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });
});
