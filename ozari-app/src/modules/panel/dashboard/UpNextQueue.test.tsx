import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { UpNextItem } from './dashboard.types';
import UpNextQueue from './UpNextQueue';

// The card has its own suite; here it only has to say which order it is and pass the handlers on.
vi.mock('./UpNextCard', () => ({
  default: ({
    item,
    onOpen,
    onAdvance,
    onPay,
  }: {
    item: UpNextItem;
    onOpen: (item: UpNextItem) => void;
    onAdvance: (item: UpNextItem, action: unknown) => void;
    onPay: (item: UpNextItem) => void;
  }) => (
    <article>
      <p>{item.clientName}</p>
      <button type="button" onClick={() => onOpen(item)}>{`open ${item.id}`}</button>
      <button type="button" onClick={() => onAdvance(item, 'step')}>{`advance ${item.id}`}</button>
      <button type="button" onClick={() => onPay(item)}>{`pay ${item.id}`}</button>
    </article>
  ),
}));

const KEY = 'modules.panel.dashboard.upNext';

const item = (id: number): UpNextItem =>
  ({ id, clientName: `Cliente ${id}`, event: { kind: 'DELIVERY' } }) as unknown as UpNextItem;

const handlers = () => ({ onOpen: vi.fn(), onAdvance: vi.fn(), onPay: vi.fn() });

/** The wrapper of the card naming `client` — the element the fold hides and makes inert. */
const slotOf = (client: string): HTMLElement =>
  screen.getByText(client).closest('.card-item') as HTMLElement;

// jsdom has no layout, so the grid reads as ONE column (`useGridColumns`): one card is the first
// row and every other card is folded — the phone case.
describe('UpNextQueue', () => {
  it('shows no toggle at all when the queue fits in one row', () => {
    render(<UpNextQueue items={[item(1)]} {...handlers()} />);

    expect(screen.getByText('Cliente 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${KEY}.showMore` })).not.toBeInTheDocument();
    expect(slotOf('Cliente 1')).not.toHaveClass('hidden');
  });

  it('folds everything after the first row behind "Ver N más"', () => {
    render(<UpNextQueue items={[item(1), item(2), item(3)]} {...handlers()} />);

    const toggle = screen.getByRole('button', { name: `${KEY}.showMore` });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', slotOf('Cliente 1').parentElement?.id);
    expect(slotOf('Cliente 1')).not.toHaveClass('hidden');
    expect(slotOf('Cliente 1')).not.toHaveAttribute('inert');
    // Folded cards are not just out of sight: they are out of the tab order too.
    for (const client of ['Cliente 2', 'Cliente 3']) {
      expect(slotOf(client)).toHaveClass('hidden');
      expect(slotOf(client)).toHaveAttribute('inert');
    }
  });

  it('unfolds in place and folds back, the label and aria-expanded following each press', async () => {
    render(<UpNextQueue items={[item(1), item(2), item(3)]} {...handlers()} />);

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.showMore` }));
    const less = screen.getByRole('button', { name: `${KEY}.showLess` });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(slotOf('Cliente 3')).not.toHaveClass('hidden');
    expect(slotOf('Cliente 3')).not.toHaveAttribute('inert');

    await userEvent.click(less);
    // The label answers at once; the cards hide once the fold has played (instant here).
    expect(screen.getByRole('button', { name: `${KEY}.showMore` })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await waitFor(() => expect(slotOf('Cliente 3')).toHaveClass('hidden'));
    expect(slotOf('Cliente 3')).toHaveAttribute('inert');
  });

  it('a fold reversed before it lands never hides the cards', async () => {
    render(<UpNextQueue items={[item(1), item(2)]} {...handlers()} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.showMore` }));

    // Fold, then unfold again in the same tick — before the fold's promise has settled.
    const toggle = screen.getByRole('button', { name: `${KEY}.showLess` });
    act(() => {
      fireEvent.click(toggle);
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: `${KEY}.showMore` }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: `${KEY}.showLess` })).toBeInTheDocument();
    expect(slotOf('Cliente 2')).not.toHaveClass('hidden');
  });

  it('drops the toggle when a refetch leaves only one row', () => {
    const props = handlers();
    const { rerender } = render(<UpNextQueue items={[item(1), item(2)]} {...props} />);
    expect(screen.getByRole('button', { name: `${KEY}.showMore` })).toBeInTheDocument();

    rerender(<UpNextQueue items={[item(1)]} {...props} />);
    expect(screen.queryByRole('button', { name: `${KEY}.showMore` })).not.toBeInTheDocument();
  });

  it('hands every card the page’s own handlers', async () => {
    const props = handlers();
    render(<UpNextQueue items={[item(1)]} {...props} />);

    await userEvent.click(screen.getByRole('button', { name: 'open 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'advance 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'pay 1' }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(props.onAdvance).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'step');
    expect(props.onPay).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});
