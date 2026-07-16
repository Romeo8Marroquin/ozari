import { render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const motion = vi.hoisted(() => ({
  pendingOut: null as null | (() => void),
  animateTilesOut: vi.fn((): Promise<void> => Promise.resolve()),
  captureGalleryLayout: vi.fn(() => ({ captured: true })),
  animateListReflow: vi.fn(),
}));
vi.mock('../pageMotion', () => ({
  animateTilesOut: motion.animateTilesOut,
  captureGalleryLayout: motion.captureGalleryLayout,
  animateListReflow: motion.animateListReflow,
}));

import type { Product } from './product.types';
import { useGridListTransition } from './useGridListTransition';

const product = (id: number): Product => ({
  id,
  name: `Producto ${id}`,
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Mesas',
  categoryId: 1,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  images: [],
  details: [],
});

/** A host that renders exactly what the grid renders: one flip-tagged wrapper per product. */
const Host: React.FC<{ products: Product[]; animate: boolean }> = ({ products, animate }) => {
  const scope = useRef<HTMLDivElement>(null);
  const displayed = useGridListTransition(products, animate, scope);
  return (
    <div ref={scope}>
      {displayed.map((item) => (
        <div key={item.id} data-flip-id={item.id} data-testid={`card-${item.id}`} />
      ))}
    </div>
  );
};

const cards = (): string[] =>
  screen.queryAllByTestId(/card-/).map((el) => el.getAttribute('data-flip-id') ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  motion.animateTilesOut.mockImplementation(() => Promise.resolve());
});

describe('useGridListTransition', () => {
  it('renders the list directly on mount — no choreography', () => {
    render(<Host products={[product(1), product(2)]} animate />);
    expect(cards()).toEqual(['1', '2']);
    expect(motion.animateTilesOut).not.toHaveBeenCalled();
  });

  it('syncs instantly when animation is off (cold/filter flows own those transitions)', () => {
    const { rerender } = render(<Host products={[product(1), product(2)]} animate={false} />);
    rerender(<Host products={[product(3)]} animate={false} />);
    expect(cards()).toEqual(['3']);
    expect(motion.animateTilesOut).not.toHaveBeenCalled();
  });

  it('syncs instantly for same-id field updates (an edit) and for infinite-scroll APPENDS', () => {
    const { rerender } = render(<Host products={[product(1), product(2)]} animate />);

    // Same ids, fresh objects — the card re-renders its content, nothing moves.
    rerender(<Host products={[product(1), product(2)]} animate />);
    expect(motion.animateTilesOut).not.toHaveBeenCalled();

    // Old ids are a strict PREFIX of the new — the append-slot machinery owns it.
    rerender(<Host products={[product(1), product(2), product(3)]} animate />);
    expect(cards()).toEqual(['1', '2', '3']);
    expect(motion.animateTilesOut).not.toHaveBeenCalled();
    expect(motion.animateListReflow).not.toHaveBeenCalled();
  });

  it('a DELETION plays the two phases: leaving card out, then capture + glide of survivors', async () => {
    const { rerender } = render(<Host products={[product(1), product(2), product(3)]} animate />);
    const leaving = screen.getByTestId('card-2');

    rerender(<Host products={[product(1), product(3)]} animate />);
    // Phase 1 targets exactly the vanished card, while the OLD list still renders.
    expect(motion.animateTilesOut).toHaveBeenCalledWith([leaving]);
    expect(cards()).toEqual(['1', '2', '3']);

    // Phase 2: the new list commits, captured layout in hand, and the survivors glide.
    await waitFor(() => expect(cards()).toEqual(['1', '3']));
    expect(motion.captureGalleryLayout).toHaveBeenCalledWith(expect.anything(), '[data-flip-id]');
    expect(motion.animateListReflow).toHaveBeenCalledWith(
      expect.anything(),
      '[data-flip-id]',
      { captured: true },
    );
  });

  it('a CREATION (new id lands first — newest-first sort) glides survivors and rises the new card in', async () => {
    const { rerender } = render(<Host products={[product(1), product(2)]} animate />);
    rerender(<Host products={[product(9), product(1), product(2)]} animate />);

    // Nothing left the list — phase 1 has no targets (resolves immediately).
    expect(motion.animateTilesOut).toHaveBeenCalledWith([]);
    await waitFor(() => expect(cards()).toEqual(['9', '1', '2']));
    expect(motion.animateListReflow).toHaveBeenCalled();
  });

  it('LATEST INTENT WINS: a newer change abandons an in-flight phase 1', async () => {
    let releaseFirst: () => void = () => undefined;
    motion.animateTilesOut.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const { rerender } = render(<Host products={[product(1), product(2)]} animate />);

    rerender(<Host products={[product(1)]} animate />); // slow phase 1 begins…
    rerender(<Host products={[product(2)]} animate />); // …and a newer change supersedes it

    releaseFirst();
    await waitFor(() => expect(cards()).toEqual(['2']));
  });
});
