import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The three motion primitives are spied on rather than run: under the suite's reduced motion they
// are no-ops anyway, and what this component decides is the ORDER of the phases, not their pixels.
const { animateTilesOut, animateListReflow, captureGalleryLayout } = vi.hoisted(() => ({
  // Typed by SIGNATURE rather than by an unused parameter, so the assertions below can read the
  // elements it was handed without the mock declaring an argument it never touches.
  animateTilesOut: vi.fn<(elements: HTMLElement[]) => Promise<void>>(() => Promise.resolve()),
  animateListReflow: vi.fn(),
  captureGalleryLayout: vi.fn(() => ({ captured: true })),
}));
vi.mock('./pageMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pageMotion')>()),
  animateTilesOut,
  animateListReflow,
  captureGalleryLayout,
}));

import ActionRow, { type ActionRowItem } from './ActionRow';

const item = (key: string): ActionRowItem => ({
  key,
  node: <button type="button">{key}</button>,
});

const items = (...keys: string[]): ActionRowItem[] => keys.map(item);

beforeEach(() => vi.clearAllMocks());

describe('ActionRow', () => {
  it('renders each action once, wrapped in its own FLIP identity', () => {
    const { container } = render(<ActionRow items={items('maps', 'pay', 'advance')} />);
    expect(screen.getByRole('button', { name: 'maps' })).toBeInTheDocument();
    expect([...container.querySelectorAll('[data-flip-id]')].map((el) => el.getAttribute('data-flip-id'))).toEqual(
      ['maps', 'pay', 'advance'],
    );
  });

  it('renders NOTHING when there is no action to offer, so the row owns its own space', () => {
    const { container } = render(<ActionRow items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('holds a removed action in place until it has animated OUT, then reflows the rest', async () => {
    // The sequence is the whole point: taking a payment removes the middle button, and running the
    // fade and the re-layout together produces a mush where the eye can follow neither.
    const { rerender } = render(<ActionRow items={items('maps', 'pay', 'advance')} />);
    rerender(<ActionRow items={items('maps', 'advance')} />);

    // Phase 1 — it is still on screen, occupying its space, while it leaves.
    expect(animateTilesOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'pay' })).toBeInTheDocument();
    expect(animateListReflow).not.toHaveBeenCalled();
    const leaving = animateTilesOut.mock.calls[0]?.[0] ?? [];
    expect(leaving.map((el) => el.getAttribute('data-flip-id'))).toEqual(['pay']);

    // Phase 2 — only once it is gone are the boxes captured and the survivors glided into the gap.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'pay' })).not.toBeInTheDocument());
    expect(captureGalleryLayout).toHaveBeenCalled();
    await waitFor(() => expect(animateListReflow).toHaveBeenCalledTimes(1));
    expect(animateListReflow.mock.calls[0]?.[2]).toEqual({ captured: true });
  });

  it('lets an ARRIVING action in immediately — nothing has to leave first', async () => {
    const { rerender } = render(<ActionRow items={items('pay', 'advance')} />);
    rerender(<ActionRow items={items('maps', 'pay', 'advance')} />);

    // Nothing was asked to leave, so phase 1 has no work and the commit lands in the same frame.
    expect(animateTilesOut).toHaveBeenCalledWith([]);
    expect(await screen.findByRole('button', { name: 'maps' })).toBeInTheDocument();
    // The reflow is what glides the survivors aside AND rises the newcomer in.
    await waitFor(() => expect(animateListReflow).toHaveBeenCalledTimes(1));
  });

  it('treats a REORDER as a layout change, because that is what it is', async () => {
    const { rerender } = render(<ActionRow items={items('pay', 'advance')} />);
    rerender(<ActionRow items={items('advance', 'pay')} />);

    expect(animateTilesOut).toHaveBeenCalledWith([]);
    await waitFor(() => expect(animateListReflow).toHaveBeenCalledTimes(1));
  });

  it('animates nothing when the same actions re-render with new labels', () => {
    // The identity is the KEY, so a button whose label morphs (Marcar En ruta → Marcar Entregado)
    // adapts in place. A background refetch handing back the same actions must be silent.
    const { rerender } = render(<ActionRow items={items('advance')} />);
    rerender(
      <ActionRow items={[{ key: 'advance', node: <button type="button">Marcar Entregado</button> }]} />,
    );

    expect(screen.getByRole('button', { name: 'Marcar Entregado' })).toBeInTheDocument();
    // Nothing structural happened at all, so neither phase runs.
    expect(animateTilesOut).not.toHaveBeenCalled();
    expect(animateListReflow).not.toHaveBeenCalled();
  });

  it('lets the LATEST change win when the set moves again mid-exit', async () => {
    // A stale leave must never commit a set that is already out of date — the same "latest intent
    // wins" rule the panel's page transitions follow.
    let release: () => void = () => undefined;
    animateTilesOut.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const { rerender } = render(<ActionRow items={items('maps', 'pay', 'advance')} />);
    rerender(<ActionRow items={items('maps', 'advance')} />);
    // …and before that exit finished, the order advanced again.
    rerender(<ActionRow items={items('advance')} />);
    release();

    await waitFor(() => expect(screen.queryByRole('button', { name: 'maps' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'pay' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'advance' })).toBeInTheDocument();
  });

  it('keeps rendering a leaving action even after its source item is gone', () => {
    // It has to be DRAWN while it fades, and by then the parent no longer supplies its node — the
    // row remembers the last one it saw.
    const { rerender } = render(<ActionRow items={items('pay')} />);
    rerender(<ActionRow items={[]} />);
    expect(screen.getByRole('button', { name: 'pay' })).toBeInTheDocument();
  });
});
