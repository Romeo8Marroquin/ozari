import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ShareButton, { SHARE_COPIED_MS } from './ShareButton';

const LABEL = 'components.share.label';
const COPIED = 'components.share.copied';

/** Install/remove `navigator.share` (jsdom has neither share nor clipboard by default). */
const withNavigatorShare = (implementation: (() => Promise<void>) | undefined): void => {
  Object.defineProperty(navigator, 'share', {
    value: implementation,
    configurable: true,
    writable: true,
  });
};
const withClipboard = (writeText: () => Promise<void>): void => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
};

afterEach(() => {
  withNavigatorShare(undefined);
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ShareButton', () => {
  it('opens the NATIVE share sheet where the platform offers one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    withNavigatorShare(share);
    render(<ShareButton title="Mesa redonda" url="https://app/panel/productos/7" />);

    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({ title: 'Mesa redonda', url: 'https://app/panel/productos/7' }),
    );
    // The sheet is the feedback — the copy-check never fires on this path.
    expect(screen.queryByRole('button', { name: COPIED })).not.toBeInTheDocument();
  });

  it('stays quiet when the user cancels the sheet (AbortError is not an error)', async () => {
    withNavigatorShare(vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError')));
    render(<ShareButton title="Mesa" url="https://app/x" />);
    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    await waitFor(() => expect(screen.getByRole('button', { name: LABEL })).toBeInTheDocument());
  });

  it('falls back to COPYING the link (icon morphs to a check, then settles back)', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    withClipboard(writeText);
    render(<ShareButton title="Mesa" url="https://app/panel/productos/7" />);

    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    await act(async () => {}); // settle the async clipboard write
    expect(screen.getByRole('button', { name: COPIED })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('https://app/panel/productos/7');

    // A second copy while confirmed just re-arms the reset window.
    fireEvent.click(screen.getByRole('button', { name: COPIED }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(SHARE_COPIED_MS);
    });
    expect(screen.getByRole('button', { name: LABEL })).toBeInTheDocument();
  });

  it('stays calm when the clipboard is denied (nothing to confirm)', async () => {
    withClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    render(<ShareButton title="Mesa" url="https://app/x" />);
    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    await waitFor(() => expect(screen.getByRole('button', { name: LABEL })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: COPIED })).not.toBeInTheDocument();
  });

  it('lands on the LEGACY copy on insecure contexts (no share, no clipboard) — check included', async () => {
    // No navigator.share, and a clipboard whose access THROWS (exactly the http:// LAN case).
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    render(<ShareButton title="Mesa" url="https://app/p/7" />);
    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    await waitFor(() => expect(screen.getByRole('button', { name: COPIED })).toBeInTheDocument());
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('stays calm when even the legacy copy refuses or throws', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });
    const { unmount } = render(<ShareButton title="Mesa" url="https://app/x" />);
    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    await waitFor(() => expect(screen.getByRole('button', { name: LABEL })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: COPIED })).not.toBeInTheDocument();
    unmount();

    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockImplementation(() => {
        throw new Error('nope');
      }),
      configurable: true,
    });
    render(<ShareButton title="Mesa" url="https://app/x" />);
    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    await waitFor(() => expect(screen.getByRole('button', { name: LABEL })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: COPIED })).not.toBeInTheDocument();
  });

  it('clears a pending reset timer on unmount', async () => {
    vi.useFakeTimers();
    withClipboard(vi.fn().mockResolvedValue(undefined));
    const { unmount } = render(<ShareButton title="Mesa" url="https://app/x" />);
    fireEvent.click(screen.getByRole('button', { name: LABEL }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: COPIED })).toBeInTheDocument();
    unmount();
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});
