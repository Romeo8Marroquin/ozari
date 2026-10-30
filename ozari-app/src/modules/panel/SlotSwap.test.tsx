import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ reduced: false, exits: [] as (() => void)[] }));

vi.mock('@utils/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/motion')>()),
  prefersReducedMotion: () => state.reduced,
}));

vi.mock('./pageMotion', () => ({
  animateHeightFrom: vi.fn(),
  editorSlotIn: vi.fn(),
  editorSlotOut: vi.fn(
    () =>
      new Promise<void>((resolve) => {
        state.exits.push(resolve);
      }),
  ),
}));

import * as pageMotion from './pageMotion';
import SlotSwap from './SlotSwap';

const settle = async (): Promise<void> => {
  await act(async () => {
    for (const resolve of state.exits.splice(0)) resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  state.reduced = false;
  state.exits = [];
  vi.clearAllMocks();
});
afterEach(() => {
  state.reduced = true;
});

describe('SlotSwap', () => {
  it('renders the live content while the key holds', () => {
    const { rerender } = render(
      <SlotSwap swapKey="a" className="cell">
        <p>uno</p>
      </SlotSwap>,
    );
    expect(screen.getByText('uno').parentElement?.parentElement).toHaveClass('cell');
    rerender(
      <SlotSwap swapKey="a">
        <p>dos</p>
      </SlotSwap>,
    );
    expect(screen.getByText('dos')).toBeInTheDocument();
    expect(pageMotion.editorSlotOut).not.toHaveBeenCalled();
  });

  it('lets the old content leave FIRST, then eases the box and slides the new content in', async () => {
    const { rerender } = render(
      <SlotSwap swapKey="a">
        <p>campo</p>
      </SlotSwap>,
    );
    rerender(
      <SlotSwap swapKey="b">
        <p>nota</p>
      </SlotSwap>,
    );
    // Still the outgoing content, inert while it leaves.
    expect(screen.getByText('campo').parentElement).toHaveAttribute('inert');
    expect(screen.queryByText('nota')).not.toBeInTheDocument();
    expect(pageMotion.editorSlotOut).toHaveBeenCalledTimes(1);

    await settle();
    expect(screen.getByText('nota')).toBeInTheDocument();
    expect(screen.getByText('nota').parentElement).not.toHaveAttribute('inert');
    expect(pageMotion.animateHeightFrom).toHaveBeenCalledWith(
      screen.getByText('nota').parentElement?.parentElement,
      expect.any(Number),
    );
    expect(pageMotion.editorSlotIn).toHaveBeenCalledWith(screen.getByText('nota').parentElement);
  });

  it('brings the content back when the key flips back mid-exit, committing nothing', async () => {
    const { rerender } = render(
      <SlotSwap swapKey="a">
        <p>campo</p>
      </SlotSwap>,
    );
    rerender(
      <SlotSwap swapKey="b">
        <p>nota</p>
      </SlotSwap>,
    );
    rerender(
      <SlotSwap swapKey="a">
        <p>campo</p>
      </SlotSwap>,
    );
    expect(pageMotion.editorSlotIn).toHaveBeenCalledTimes(1);
    await settle();
    expect(screen.getByText('campo')).toBeInTheDocument();
    expect(pageMotion.animateHeightFrom).not.toHaveBeenCalled();
  });

  it('swaps at once with motion reduced', () => {
    state.reduced = true;
    const { rerender } = render(
      <SlotSwap swapKey="a">
        <p>campo</p>
      </SlotSwap>,
    );
    rerender(
      <SlotSwap swapKey="b">
        <p>nota</p>
      </SlotSwap>,
    );
    expect(screen.getByText('nota')).toBeInTheDocument();
    expect(pageMotion.editorSlotOut).not.toHaveBeenCalled();
  });
});
