import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CopyButton from './CopyButton';

const writeText = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

const clickCopy = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button'));
  });
};

describe('CopyButton', () => {
  it('copies the value, shows the confirmation, then reverts after the timeout', async () => {
    render(<CopyButton value="SECRET-123" label="copy" copiedLabel="copied" />);
    expect(screen.getByRole('button')).toHaveTextContent('copy');

    await clickCopy();
    expect(writeText).toHaveBeenCalledWith('SECRET-123');
    expect(screen.getByRole('button')).toHaveTextContent('copied');

    act(() => vi.advanceTimersByTime(1800));
    expect(screen.getByRole('button')).toHaveTextContent('copy');
  });

  it('stays quiet (no confirmation) when the clipboard write is rejected', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<CopyButton value="x" label="copy" copiedLabel="copied" />);

    await clickCopy();
    expect(writeText).toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveTextContent('copy');
  });

  it('resets the pending timer on a second copy (no stale revert)', async () => {
    render(<CopyButton value="x" label="copy" copiedLabel="copied" />);
    await clickCopy();
    act(() => vi.advanceTimersByTime(1000));
    await clickCopy(); // re-arms the 1.8s window
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('button')).toHaveTextContent('copied');
  });
});
