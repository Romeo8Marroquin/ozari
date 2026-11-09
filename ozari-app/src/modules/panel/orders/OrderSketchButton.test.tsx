import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import gsap from 'gsap';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hooks/useRole', () => ({ getStoredUserId: () => 1, useHasRole: () => true }));

import { PanelNavContext } from '../PanelNavContext';
import type { Product } from '../products/product.types';
import OrderSketchButton from './OrderSketchButton';
import { addToSketch, setSketchQuantity } from './orderSketch';

const K = 'modules.panel.orderSketch';
const product = (id: number): Product => ({
  id,
  name: `P${id}`,
  businessType: 'Venta',
  businessTypeId: 2,
  category: 'Vasos',
  categoryId: 1,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  images: [],
  details: [],
});

const renderButton = () => {
  const navigateTo = vi.fn();
  render(
    <PanelNavContext.Provider value={{ navigateTo, pending: null }}>
      <OrderSketchButton />
    </PanelNavContext.Provider>,
  );
  return navigateTo;
};
const badge = (): HTMLElement => document.querySelector('[data-sketch-badge]') as HTMLElement;
const originalMatchMedia = window.matchMedia;

beforeEach(() => localStorage.clear());
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('OrderSketchButton', () => {
  it('is an empty cart until something is added — no badge, and still the way to a new order', async () => {
    const navigateTo = renderButton();
    const button = screen.getByRole('button', { name: `${K}.buttonEmpty` });
    expect(badge()).toHaveClass('opacity-0');
    await userEvent.click(button);
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos/nuevo');
  });

  it('counts the sketch’s lines live, and keeps the last number painted while the badge leaves', () => {
    renderButton();
    act(() => {
      addToSketch(product(1), null, [], undefined);
      addToSketch(product(2), null, [], undefined);
    });
    expect(screen.getByRole('button', { name: `${K}.buttonCount` })).toBeInTheDocument();
    expect(badge()).toHaveClass('opacity-100');
    expect(badge()).toHaveTextContent('2');
    act(() => {
      setSketchQuantity(1, null, 0);
      setSketchQuantity(2, null, 0);
    });
    expect(badge()).toHaveClass('opacity-0');
    expect(badge()).toHaveTextContent('2');
  });

  it('gives the cart a small hop when a line ARRIVES (motion allowed), and none when one leaves', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const fromTo = vi.spyOn(gsap, 'fromTo');
    renderButton();
    act(() => {
      addToSketch(product(1), null, [], undefined);
    });
    expect(fromTo).toHaveBeenCalledTimes(1);
    act(() => {
      setSketchQuantity(1, null, 0);
    });
    expect(fromTo).toHaveBeenCalledTimes(1);
  });
});
