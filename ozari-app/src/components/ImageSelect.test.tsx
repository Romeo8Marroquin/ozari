import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageSelect, { type ImageSelectOption } from './ImageSelect';

const OPTIONS: ImageSelectOption[] = [
  { value: 1, label: 'Silla plástica', imageUrl: 'https://cdn/silla.webp' },
  { value: 2, label: 'Camino de mesa' },
  { value: 3, label: 'Candelabros', imageUrl: null },
  { value: 4, label: 'Números en acrílico' },
];

type Props = Partial<React.ComponentProps<typeof ImageSelect>>;

/** A controlled harness — the select is always driven by its `value`. */
const Harness: React.FC<Props & { initial?: number | null }> = ({ initial = null, onChange, ...props }) => {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <ImageSelect
        id="product"
        label="Producto"
        placeholderOption="Selecciona un producto"
        options={OPTIONS}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        {...props}
      />
      <button type="button">afuera</button>
    </>
  );
};

const trigger = () => screen.getByRole('combobox');
const listbox = () =>
  document.getElementById(trigger().getAttribute('aria-controls') as string) as HTMLElement;
const activeLabel = () =>
  document.getElementById(trigger().getAttribute('aria-activedescendant') as string)?.textContent;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ImageSelect', () => {
  it('is a labelled combobox that opens a listbox of PHOTO rows', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(trigger()).toHaveAccessibleName('Producto');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    // Nothing mounted until someone looks — the photos load on demand.
    expect(listbox()).toBeNull();

    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveFocus();
    const options = within(listbox()).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Selecciona un producto',
      ...OPTIONS.map((option) => option.label),
    ]);
    // A photo where there is one, the brand mark where there is not; the "nothing" row has neither.
    expect(options[1].querySelector('img')).toHaveAttribute('src', 'https://cdn/silla.webp');
    expect(options[2].querySelector('[data-layer="brand"]')).toBeInTheDocument();
    expect(options[0].querySelector('[data-layer]')).toBeNull();
    // Opening highlights the current pick (here: the "nothing" row).
    expect(activeLabel()).toBe('Selecciona un producto');
  });

  it('picks with a press, closes, and leaves the list mounted only through its exit fade', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await user.click(trigger());
    await user.click(within(listbox()).getByRole('option', { name: 'Candelabros' }));
    expect(onChange).toHaveBeenCalledWith(3);
    expect(trigger()).toHaveTextContent('Candelabros');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(listbox()).toHaveAttribute('inert');
    await waitFor(() => expect(listbox()).toBeNull());

    // Re-picking the same row is no change; the "nothing" row clears.
    await user.click(trigger());
    expect(activeLabel()).toBe('Candelabros');
    expect(within(listbox()).getByRole('option', { name: 'Candelabros' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(listbox()).getByRole('option', { name: 'Candelabros' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    await user.click(trigger());
    await user.click(within(listbox()).getByRole('option', { name: 'Selecciona un producto' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('toggles closed from its own button, and a hovered row becomes the highlighted one', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    fireEvent.pointerMove(within(listbox()).getByRole('option', { name: 'Camino de mesa' }));
    expect(activeLabel()).toBe('Camino de mesa');
    fireEvent.pointerMove(within(listbox()).getByRole('option', { name: 'Camino de mesa' }));
    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a press OUTSIDE (not inside the list), and on blur — reporting the blur', async () => {
    const onBlur = vi.fn();
    const user = userEvent.setup();
    render(<Harness onBlur={onBlur} />);
    await user.click(trigger());
    // A press inside the list keeps it open and the focus on the field.
    fireEvent.pointerDown(listbox());
    expect(fireEvent.mouseDown(listbox())).toBe(false); // default prevented
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(document.body);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'afuera' }));
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(onBlur).toHaveBeenCalled();
  });

  it('speaks the native keyboard: arrows open and move, Enter / Space pick, Escape / Tab close', async () => {
    const onChange = vi.fn();
    const onEngage = vi.fn();
    render(<Harness onChange={onChange} onEngage={onEngage} />);
    const field = trigger();
    field.focus();

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(onEngage).toHaveBeenCalled();
    expect(field).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(activeLabel()).toBe('Silla plástica');
    fireEvent.keyDown(field, { key: 'End' });
    expect(activeLabel()).toBe('Números en acrílico');
    fireEvent.keyDown(field, { key: 'ArrowDown' }); // clamps at the end — no wrap
    expect(activeLabel()).toBe('Números en acrílico');
    fireEvent.keyDown(field, { key: 'Home' });
    expect(activeLabel()).toBe('Selecciona un producto');
    fireEvent.keyDown(field, { key: 'ArrowUp' }); // clamps at the start
    expect(activeLabel()).toBe('Selecciona un producto');
    fireEvent.keyDown(field, { key: 'PageDown' });
    expect(activeLabel()).toBe('Números en acrílico');
    fireEvent.keyDown(field, { key: 'PageUp' });
    expect(activeLabel()).toBe('Selecciona un producto');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(field).toHaveAttribute('aria-expanded', 'false');

    // Space opens, Space picks — and its keyup never re-activates the button.
    fireEvent.keyDown(field, { key: ' ' });
    expect(field).toHaveAttribute('aria-expanded', 'true');
    expect(activeLabel()).toBe('Silla plástica'); // opens on the current pick
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: ' ' });
    expect(fireEvent.keyUp(field, { key: ' ' })).toBe(false);
    expect(fireEvent.keyUp(field, { key: 'a' })).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(2);

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    fireEvent.keyDown(field, { key: 'Tab' });
    expect(field).toHaveAttribute('aria-expanded', 'false');
    // Keys that mean nothing here do nothing, open or closed.
    fireEvent.keyDown(field, { key: 'Shift' });
    expect(field).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'F2' });
    expect(field).toHaveAttribute('aria-expanded', 'true');
  });

  it('jumps by typed letters — accent-insensitive, a repeated letter cycles, a space can be a letter', () => {
    const now = vi.spyOn(Date, 'now');
    let clock = 10_000;
    now.mockImplementation(() => clock);
    render(<Harness />);
    const field = trigger();

    // Closed: a letter opens the list ON its match.
    fireEvent.keyDown(field, { key: 'n' });
    expect(field).toHaveAttribute('aria-expanded', 'true');
    expect(activeLabel()).toBe('Números en acrílico');

    clock += 1000; // a pause starts a new search
    fireEvent.keyDown(field, { key: 'c' });
    expect(activeLabel()).toBe('Camino de mesa');
    clock += 1000;
    fireEvent.keyDown(field, { key: 'c' }); // the same letter again → the next "c" row
    expect(activeLabel()).toBe('Candelabros');

    // "camino d…": letters typed together build ONE search, and the space inside it is a letter.
    clock += 1000;
    for (const key of ['c', 'a', 'm', 'i', 'n', 'o', ' ', 'd']) {
      fireEvent.keyDown(field, { key });
      clock += 50;
    }
    expect(field).toHaveAttribute('aria-expanded', 'true');
    expect(activeLabel()).toBe('Camino de mesa');

    // Nothing matches → the highlight stays put; modified keys are not typing.
    fireEvent.keyDown(field, { key: 'z' });
    expect(activeLabel()).toBe('Camino de mesa');
    fireEvent.keyDown(field, { key: 'n', ctrlKey: true });
    fireEvent.keyDown(field, { key: 'n', metaKey: true });
    fireEvent.keyDown(field, { key: 'n', altKey: true });
    expect(activeLabel()).toBe('Camino de mesa');
  });

  it('keeps the highlighted row in view — centred on open, by the minimum while arrowing', () => {
    // jsdom has no layout: give the rows 50px each in a 100px list, and a writable scrollTop.
    const rowTop = function (this: HTMLElement) {
      return this.getAttribute('role') === 'option' ? Number(this.id.split('-').pop()) * 50 : 0;
    };
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(rowTop);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(50);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
    const scrolls: number[] = [];
    let scrollTop = 0;
    vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(() => scrollTop);
    vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation((value: number) => {
      scrollTop = value;
      scrolls.push(value);
    });

    render(<Harness initial={2} />);
    const field = trigger();
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(scrolls.at(-1)).toBe(2 * 50 - (100 - 50) / 2); // "Camino de mesa" centred
    fireEvent.keyDown(field, { key: 'End' }); // row 4 (200–250) is below the window
    expect(scrolls.at(-1)).toBe(250 - 100);
    fireEvent.keyDown(field, { key: 'Home' }); // row 0 is above it
    expect(scrolls.at(-1)).toBe(0);
    const count = scrolls.length;
    fireEvent.keyDown(field, { key: 'ArrowDown' }); // row 1 already fully visible → no scroll
    expect(scrolls).toHaveLength(count);
  });

  it('anchors under the field, opens UPWARD near the bottom, and re-anchors on scroll / resize', async () => {
    const rect = { top: 100, bottom: 140, left: 20, right: 220, width: 200, height: 40 };
    vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ ...rect, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect,
    );
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    // Below the field; never narrower than a readable photo row.
    expect(listbox().style.top).toBe('148px');
    expect(listbox().style.width).toBe('256px');
    expect(listbox().style.left).toBe('20px');

    // The page scrolls the field near the bottom of the window → the list flips above it.
    rect.top = window.innerHeight - 60;
    rect.bottom = window.innerHeight - 20;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(listbox().style.top).toBe('');
    expect(listbox().style.bottom).toBe('68px');

    // The list scrolling ITSELF moves nothing; a resize re-anchors.
    rect.top = 100;
    rect.bottom = 140;
    act(() => {
      listbox().dispatchEvent(new Event('scroll'));
    });
    expect(listbox().style.bottom).toBe('68px');
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(listbox().style.top).toBe('148px');

    // Closing while flipped above retracts upward-anchored; nothing re-anchors once closed.
    rect.top = window.innerHeight - 60;
    rect.bottom = window.innerHeight - 20;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    expect(listbox()).toHaveClass('translate-y-1');
  });

  it('wears the field family: required / optional marks, error ink, a disabled field never opens', async () => {
    const { rerender } = render(<Harness isRequired error />);
    expect(trigger()).toHaveAttribute('aria-required', 'true');
    expect(trigger()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('components.customInput.requiredField')).toBeInTheDocument();

    rerender(<Harness optionalLabel />);
    expect(screen.getByText('components.customInput.optionalField')).toBeInTheDocument();

    rerender(<Harness disabled />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('holds its height with a blank value when there is no placeholder row', async () => {
    const user = userEvent.setup();
    render(<Harness placeholderOption={undefined} />);
    expect(trigger().textContent).toBe(' ');
    await user.click(trigger());
    // Without a "nothing" row, the first product is highlighted.
    expect(activeLabel()).toBe('Silla plástica');
  });

  it('forwards its ref to the field (RHF focuses it on an error)', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <ImageSelect ref={ref} id="p" label="Producto" options={OPTIONS} value={4} onChange={() => {}} />,
    );
    expect(ref.current).toBe(trigger());
    expect(trigger()).toHaveTextContent('Números en acrílico');
  });
});
