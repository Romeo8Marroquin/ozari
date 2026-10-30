import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  reduced: false,
  /** Resolvers of every `detailRowOut` in flight — a test settles the exit when it chooses. */
  exits: [] as (() => void)[],
}));

vi.mock('@utils/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/motion')>()),
  prefersReducedMotion: () => state.reduced,
}));

vi.mock('./pageMotion', () => ({
  captureElements: vi.fn((elements: HTMLElement[]) => ({ captured: elements.length })),
  detailRowIn: vi.fn(),
  detailRowOut: vi.fn(
    () =>
      new Promise<void>((resolve) => {
        state.exits.push(resolve);
      }),
  ),
  glideReorder: vi.fn(),
  restoreListItem: vi.fn(),
  revealInScroller: vi.fn(),
}));

import * as pageMotion from './pageMotion';
import useListMotion from './useListMotion';

const settleExits = async (): Promise<void> => {
  await act(async () => {
    for (const resolve of state.exits.splice(0)) resolve();
    await Promise.resolve();
  });
};

/** Arm the hook: it ignores mounts until one frame after its own. */
const nextFrame = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });
};

interface Item {
  id: string;
  children?: string[];
}

const List: React.FC<{ initial: Item[]; keep?: boolean }> = ({ initial, keep = false }) => {
  const [items, setItems] = useState(initial);
  const [disabledUp, setDisabledUp] = useState(false);
  const motion = useListMotion();
  const add = (item: Item, reveal = false): void => {
    if (reveal) motion.reveal(item.id);
    setItems((current) => [...current, item]);
  };
  const remove = (id: string): void =>
    motion.leave(
      [id],
      () => setItems((current) => (keep ? [...current] : current.filter((item) => item.id !== id))),
      { focusFallback: () => document.getElementById('add') },
    );
  return (
    <div>
      <button id="add" type="button" onClick={() => add({ id: 'z' }, true)}>
        add
      </button>
      <button type="button" onClick={() => add({ id: 'p', children: ['p1'] })}>
        add-parent
      </button>
      <button
        type="button"
        onClick={() =>
          motion.reorder(
            // An id with nothing mounted under it is simply skipped.
            [...items.map((item) => item.id), 'missing'],
            () => {
              setItems((current) => [...current].reverse());
              setDisabledUp(true);
            },
          )
        }
      >
        reverse
      </button>
      <button
        type="button"
        onClick={() =>
          motion.leave(['a', 'b'], () =>
            setItems((current) => current.filter((item) => item.id !== 'a' && item.id !== 'b')),
          )
        }
      >
        clear
      </button>
      <ul data-gap="12px">
        {items.map((item) => (
          <li key={item.id} ref={motion.item(item.id)} data-testid={item.id}>
            <span>{motion.leaving.has(item.id) ? 'leaving' : 'here'}</span>
            <button
              type="button"
              // `c` names no preferred control: focus falls to its first enabled one.
              data-focus-on-remove={item.id === 'c' ? undefined : true}
              onClick={() => remove(item.id)}
            >
              remove {item.id}
            </button>
            <button type="button" disabled={disabledUp && item.id === 'a'}>
              up {item.id}
            </button>
            {item.children?.map((child) => (
              <div key={child} ref={motion.item(child)} data-testid={child} />
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
};

const realComputedStyle = window.getComputedStyle.bind(window);

beforeEach(() => {
  state.reduced = false;
  state.exits = [];
  vi.clearAllMocks();
  // jsdom computes no `row-gap`: a container marked `data-gap` reports one.
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = realComputedStyle(element, pseudo);
    const gap = (element as HTMLElement).dataset?.gap;
    return new Proxy(style, {
      get: (target, property) => {
        if (property === 'rowGap' && gap) return gap;
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  });
});
afterEach(() => {
  state.reduced = true;
  vi.restoreAllMocks();
});

describe('useListMotion — entering', () => {
  it('lets the first commit ride the page entrance, then grows every later arrival once', async () => {
    render(<List initial={[{ id: 'a' }]} />);
    expect(pageMotion.detailRowIn).not.toHaveBeenCalled();
    await nextFrame();

    await userEvent.click(screen.getByText('add'));
    expect(pageMotion.detailRowIn).toHaveBeenCalledWith(screen.getByTestId('z'), 12);
    expect(pageMotion.revealInScroller).toHaveBeenCalledWith(screen.getByTestId('z'));
  });

  it('grows a parent and lets the child it brings ride along', async () => {
    render(<List initial={[]} />);
    await nextFrame();
    await userEvent.click(screen.getByText('add-parent'));
    expect(pageMotion.detailRowIn).toHaveBeenCalledTimes(1);
    expect(pageMotion.detailRowIn).toHaveBeenCalledWith(screen.getByTestId('p'), 12);
    expect(pageMotion.revealInScroller).not.toHaveBeenCalled();
  });

  it('reads no gap from an element without a parent rule', async () => {
    const Lone: React.FC = () => {
      const motion = useListMotion();
      const [shown, setShown] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setShown(true)}>
            show
          </button>
          {shown && <p ref={motion.item('x')}>x</p>}
        </>
      );
    };
    render(<Lone />);
    await nextFrame();
    await userEvent.click(screen.getByText('show'));
    expect(pageMotion.detailRowIn).toHaveBeenCalledWith(screen.getByText('x'), 0);
  });
});

describe('useListMotion — leaving', () => {
  it('plays the exit FIRST, commits after, and hands focus to the neighbour', async () => {
    render(<List initial={[{ id: 'a' }, { id: 'b' }]} />);
    await userEvent.click(screen.getByText('remove a'));
    expect(screen.getByTestId('a')).toHaveAttribute('data-leaving');
    expect(screen.getByTestId('a')).toHaveTextContent('leaving');
    expect(pageMotion.detailRowOut).toHaveBeenCalledWith(screen.getByTestId('a'), 12);

    // A second click while it is leaving is ignored.
    await userEvent.click(screen.getByText('remove a'));
    expect(pageMotion.detailRowOut).toHaveBeenCalledTimes(1);

    await settleExits();
    expect(screen.queryByTestId('a')).not.toBeInTheDocument();
    expect(screen.getByText('remove b')).toHaveFocus();
  });

  it('hands focus to the previous item when the last one leaves, and to the fallback when none is left', async () => {
    render(<List initial={[{ id: 'a' }, { id: 'b' }]} />);
    await userEvent.click(screen.getByText('remove b'));
    await settleExits();
    expect(screen.getByText('remove a')).toHaveFocus();

    await userEvent.click(screen.getByText('remove a'));
    await settleExits();
    expect(screen.getByText('add')).toHaveFocus();
  });

  it("falls back to a neighbour's first enabled control when it marks none", async () => {
    render(<List initial={[{ id: 'a' }, { id: 'b' }, { id: 'c' }]} />);
    await userEvent.click(screen.getByText('remove b'));
    await settleExits();
    expect(screen.getByText('remove c')).toHaveFocus();
  });

  it('leaves focus alone when it was elsewhere', async () => {
    render(<List initial={[{ id: 'a' }, { id: 'b' }, { id: 'c' }]} />);
    await userEvent.click(screen.getByText('clear'));
    await settleExits();
    expect(screen.queryByTestId('a')).not.toBeInTheDocument();
    expect(screen.getByText('clear')).toHaveFocus();
  });

  it('skips neighbours that are leaving in the same gesture', async () => {
    render(<List initial={[{ id: 'a' }, { id: 'b' }, { id: 'c' }]} />);
    screen.getByText('remove a').focus();
    fireEvent.click(screen.getByText('clear'));
    await settleExits();
    expect(screen.getByText('remove c')).toHaveFocus();
  });

  it('restores an item whose commit kept it', async () => {
    render(<List initial={[{ id: 'a' }]} keep />);
    await userEvent.click(screen.getByText('remove a'));
    await settleExits();
    expect(screen.getByTestId('a')).not.toHaveAttribute('data-leaving');
    expect(pageMotion.restoreListItem).toHaveBeenCalledWith(screen.getByTestId('a'));
  });

  it('commits at once with motion reduced, or with nothing mounted to animate', async () => {
    state.reduced = true;
    render(<List initial={[{ id: 'a' }, { id: 'b' }]} />);
    await userEvent.click(screen.getByText('remove a'));
    expect(pageMotion.detailRowOut).not.toHaveBeenCalled();
    expect(screen.queryByTestId('a')).not.toBeInTheDocument();
    expect(screen.getByText('remove b')).toHaveFocus();

    state.reduced = false;
    const Ghost: React.FC = () => {
      const motion = useListMotion();
      const [done, setDone] = useState(false);
      return (
        <button type="button" onClick={() => motion.leave(['nobody'], () => setDone(true))}>
          {done ? 'gone' : 'ghost'}
        </button>
      );
    };
    render(<Ghost />);
    await userEvent.click(screen.getByText('ghost'));
    expect(screen.getByText('gone')).toBeInTheDocument();
  });
});

describe('useListMotion — reordering', () => {
  it('captures, commits, then glides the items to their new places', async () => {
    render(<List initial={[{ id: 'a' }, { id: 'b' }]} />);
    const a = screen.getByTestId('a');
    const b = screen.getByTestId('b');
    // The move comes from a button outside the items: focus is not inside them, nothing refocuses.
    await userEvent.click(screen.getByText('reverse'));
    expect(pageMotion.captureElements).toHaveBeenCalledWith([a, b]);
    expect(pageMotion.glideReorder).toHaveBeenCalledWith([a, b], { captured: 2 });
    expect(screen.getByText('reverse')).toHaveFocus();
  });

  it('refocuses the moved control, or its first enabled sibling once it is disabled', async () => {
    render(<List initial={[{ id: 'a' }, { id: 'b' }]} />);
    const Trigger = screen.getByText('up a');
    Trigger.focus();
    // Reverse through the keyboard path: the focused control is inside a moved item.
    const reverse = screen.getByText('reverse');
    await act(async () => {
      Trigger.blur();
      Trigger.focus();
      reverse.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // `up a` became disabled by the commit → focus goes to its first enabled sibling.
    expect(screen.getByText('remove a')).toHaveFocus();
  });

  it('puts focus back on a moved control that the browser blurred', async () => {
    const Moves: React.FC = () => {
      const motion = useListMotion();
      const [items, setItems] = useState(['a', 'b']);
      return (
        <ul>
          {items.map((id) => (
            <li key={id} ref={motion.item(id)}>
              <button
                type="button"
                onClick={(event) => {
                  const button = event.currentTarget;
                  motion.reorder(items, () => {
                    setItems((current) => [...current].reverse());
                    // The first move blurs it (as a browser may); later ones keep it.
                    if (items[0] === id) button.blur();
                  });
                }}
              >
                move {id}
              </button>
            </li>
          ))}
        </ul>
      );
    };
    render(<Moves />);
    await userEvent.click(screen.getByText('move a'));
    expect(screen.getByText('move a')).toHaveFocus();
    // A control that kept its focus through the move is left exactly where it is.
    const a = screen.getByText('move a');
    a.focus();
    const focus = vi.spyOn(a, 'focus');
    fireEvent.click(a);
    expect(a).toHaveFocus();
    expect(focus).not.toHaveBeenCalled();
  });

  it('lets focus go quietly with no neighbour and no fallback', async () => {
    const Single: React.FC = () => {
      const motion = useListMotion();
      const [shown, setShown] = useState(true);
      return shown ? (
        <p ref={motion.item('only')}>
          <button type="button" onClick={() => motion.leave(['only'], () => setShown(false))}>
            only
          </button>
        </p>
      ) : null;
    };
    render(<Single />);
    await userEvent.click(screen.getByText('only'));
    await settleExits();
    expect(document.body).toHaveFocus();
  });
});
