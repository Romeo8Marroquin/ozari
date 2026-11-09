import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hooks/useRole', () => ({ getStoredUserId: () => 1, useHasRole: () => true }));

import { StorageKeys } from '@constants/StorageKeys';
import { Storage } from '@utils/storage';
import { PanelNavContext } from '../PanelNavContext';
import type { Product } from '../products/product.types';
import { readOrderDraft, saveOrderDraft } from './orderDraft';
import { findSketchLine, pristineOrderValues } from './orderSketch';
import SketchQuickAdd from './SketchQuickAdd';

const readSketchForTest = readOrderDraft;

const K = 'modules.panel.orderSketch';
const STEP = 'components.quantityStepper';

const chair: Product = {
  id: 3,
  name: 'Silla',
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Sillas',
  categoryId: 1,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 6,
  images: [{ id: 1, url: 'https://cdn/silla.webp', isPrimary: true, sortOrder: 0 }],
  details: [],
  available: 3,
};

const renderAdd = (product: Product = chair) => {
  const navigateTo = vi.fn();
  render(
    <PanelNavContext.Provider value={{ navigateTo, pending: null }}>
      <SketchQuickAdd product={product} />
    </PanelNavContext.Provider>,
  );
  return navigateTo;
};
const trigger = (): HTMLElement => screen.getAllByRole('button')[0] as HTMLElement;
const card = (): HTMLElement | null => document.querySelector('[role="dialog"]');
const quantity = (): string | undefined => findSketchLine(readSketchForTest(), 3, null)?.quantity;
const originalMatchMedia = window.matchMedia;

beforeEach(() => localStorage.clear());
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SketchQuickAdd', () => {
  it('adds ONE unit on the first press and opens the quantity card right there', async () => {
    renderAdd();
    expect(trigger()).toHaveAccessibleName(`${K}.addNamed`);
    expect(card()).toBeNull();
    await userEvent.click(trigger());
    expect(quantity()).toBe('1');
    expect(card()).not.toHaveAttribute('inert');
    // In the sketch: magenta, wearing the quantity.
    expect(trigger()).toHaveAccessibleName(`${K}.editNamed`);
    expect(trigger()).toHaveClass('bg-magenta');
    expect(trigger()).toHaveTextContent('1');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(`${K}.inSketch`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.cap.today`)).toBeInTheDocument();
  });

  it('adjusts the line from the card, and "Ver pedido" leaves for the order form', async () => {
    const navigateTo = renderAdd();
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('button', { name: `${STEP}.increase` }));
    expect(quantity()).toBe('2');
    expect(trigger()).toHaveTextContent('2');
    await userEvent.click(screen.getByRole('button', { name: `${K}.view` }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos/nuevo');
    expect(card()).toHaveAttribute('inert');
  });

  it('closes when the trash can takes the line out — nothing is left to adjust', async () => {
    renderAdd();
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('button', { name: `${STEP}.remove` }));
    expect(quantity()).toBeUndefined();
    expect(card()).toHaveAttribute('inert');
    expect(trigger()).toHaveAccessibleName(`${K}.addNamed`);
  });

  it('a press on a line ALREADY in the sketch opens the card without adding; a second press closes it', async () => {
    saveOrderDraft({
      ...pristineOrderValues(),
      lines: [{ productId: 3, variantId: null, pickedValues: [], quantity: '2', isRental: true }],
    });
    renderAdd();
    await userEvent.click(trigger());
    expect(quantity()).toBe('2');
    expect(card()).not.toHaveAttribute('inert');
    await userEvent.click(trigger());
    expect(card()).toHaveAttribute('inert');
  });

  it('closes on Escape (focus back on the button), on a press outside, or when focus moves away', async () => {
    renderAdd();
    await userEvent.click(trigger());
    fireEvent.keyDown(card() as HTMLElement, { key: 'Escape' });
    expect(card()).toHaveAttribute('inert');
    expect(trigger()).toHaveFocus();

    await userEvent.click(trigger());
    fireEvent.keyDown(card() as HTMLElement, { key: 'Enter' }); // any other key: stays
    fireEvent.pointerDown(card() as HTMLElement); // inside: stays
    expect(card()).not.toHaveAttribute('inert');
    fireEvent.pointerDown(document.body);
    expect(card()).toHaveAttribute('inert');

    await userEvent.click(trigger());
    const input = screen.getByRole('textbox');
    // Focus to nowhere (a press on the card's padding) keeps it; to the trigger keeps it; elsewhere closes.
    fireEvent.focusOut(input, { relatedTarget: null });
    fireEvent.focusOut(input, { relatedTarget: trigger() });
    fireEvent.focusOut(input, { relatedTarget: screen.getByRole('button', { name: `${STEP}.increase` }) });
    expect(card()).not.toHaveAttribute('inert');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    fireEvent.focusOut(input, { relatedTarget: outside });
    expect(card()).toHaveAttribute('inert');
    outside.remove();
  });

  it('unmounts the card once its exit has played', () => {
    vi.useFakeTimers();
    renderAdd();
    fireEvent.click(trigger());
    fireEvent.pointerDown(document.body);
    expect(card()).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(card()).toBeNull();
  });

  it('is muted and inert when nothing is takeable', () => {
    renderAdd({ ...chair, available: 0 });
    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveAccessibleName(`${K}.unavailableNamed`);
  });

  it('adds a product WITH variations generically, and says the variation is chosen in the order', async () => {
    const cloth: Product = {
      ...chair,
      id: 7,
      available: undefined,
      options: [{ id: 10, name: 'Color', sortOrder: 0, kind: 'generic', values: [] }],
      variants: [
        { id: 71, valueIds: [1], label: 'Rojo', isDefault: true },
        { id: 72, valueIds: [2], label: 'Azul', isDefault: false },
      ],
    };
    renderAdd(cloth);
    await userEvent.click(trigger());
    expect(findSketchLine(readSketchForTest(), 7, null)?.quantity).toBe('1');
    expect(screen.getByText(`${K}.variantLater`)).toBeInTheDocument();
    // No figure measures it: no cap hint.
    expect(screen.queryByText(`${K}.cap.today`)).not.toBeInTheDocument();
  });

  it('speaks for the sketch’s DATES once it has them', async () => {
    saveOrderDraft({ ...pristineOrderValues(), deliveryAt: '2026-12-01T10:00' });
    renderAdd();
    await userEvent.click(trigger());
    expect(screen.getByText(`${K}.cap.dated`)).toBeInTheDocument();
  });

  it('opens ABOVE the button with room there, BELOW it near the top — and follows a scroll', async () => {
    const rect = (top: number) =>
      ({ top, bottom: top + 36, left: 300, right: 336, width: 36, height: 36, x: 300, y: top, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(600));
    renderAdd();
    await userEvent.click(trigger());
    expect((card() as HTMLElement).style.bottom).not.toBe('');
    expect((card() as HTMLElement).style.top).toBe('');
    // Leaving from above, it sinks back DOWN toward the button.
    await userEvent.click(trigger());
    expect(card()).toHaveClass('translate-y-1');
    await userEvent.click(trigger());
    spy.mockReturnValue(rect(20));
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect((card() as HTMLElement).style.top).toBe(`${20 + 36 + 8}px`);
    // Leaving from below, it slides back UP toward the button.
    fireEvent.pointerDown(document.body);
    expect(card()).toHaveClass('-translate-y-1');
  });

  it('owns up to a line ABOVE what is takeable now — the form will trim it', async () => {
    saveOrderDraft({
      ...pristineOrderValues(),
      lines: [{ productId: 3, variantId: null, pickedValues: [], quantity: '5', isRental: true }],
    });
    renderAdd();
    await userEvent.click(trigger());
    expect(screen.getByText(`${K}.cap.over`)).toHaveClass('text-amber-700');
  });

  it('puts the cursor in the number on a fine pointer, never on touch', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(hover: hover) and (pointer: fine)' || query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    renderAdd();
    await userEvent.click(trigger());
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(Storage.get(StorageKeys.ORDER_CREATE_DRAFT)).not.toBeNull();
  });
});
