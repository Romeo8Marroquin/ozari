import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hooks/useRole', () => ({ getStoredUserId: () => 1, useHasRole: () => true }));

import { PanelNavContext } from '../PanelNavContext';
import type { Product, ProductVariant } from '../products/product.types';
import { readOrderDraft, saveOrderDraft } from './orderDraft';
import { findSketchLine, pristineOrderValues } from './orderSketch';
import SketchDetailAdd from './SketchDetailAdd';

const K = 'modules.panel.orderSketch';
const STEP = 'components.quantityStepper';

const base: Product = {
  id: 5,
  name: 'Mantel',
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Mantelería',
  categoryId: 2,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 20,
  images: [],
  details: [],
};

const red: ProductVariant = { id: 51, valueIds: [1, 3], label: 'Rojo · Redondo', isDefault: true, available: 4 };
const blue: ProductVariant = { id: 52, valueIds: [2, 3], label: 'Azul · Redondo', isDefault: false, available: 2 };
const cloth: Product = {
  ...base,
  available: 6,
  options: [
    { id: 10, name: 'Color', sortOrder: 0, kind: 'generic', values: [] },
    { id: 11, name: 'Forma', sortOrder: 1, kind: 'generic', values: [] },
  ],
  variants: [red, blue],
};

const renderAdd = (product: Product, picks: (number | null)[] = [], variant?: ProductVariant) => {
  const navigateTo = vi.fn();
  render(
    <PanelNavContext.Provider value={{ navigateTo, pending: null }}>
      <SketchDetailAdd product={product} picks={picks} variant={variant} />
    </PanelNavContext.Provider>,
  );
  return navigateTo;
};
const addButton = (): HTMLElement => screen.getByRole('button', { name: `${K}.add` });

beforeEach(() => localStorage.clear());

describe('SketchDetailAdd', () => {
  it('adds the GENERIC product with the picks made so far, and says the variation is chosen later', async () => {
    renderAdd(cloth, [1, null]);
    expect(screen.getByText(`${K}.variantLater`)).toBeInTheDocument();
    expect(screen.getByText(`${K}.cap.today`)).toBeInTheDocument();
    await userEvent.click(addButton());
    const line = findSketchLine(readOrderDraft(), 5, null);
    expect(line?.quantity).toBe('1');
    expect(line?.pickedValues).toEqual([1, null]);
    // In the sketch: the stepper and the way to the form take the button's place.
    expect(screen.getByText(`${K}.inSketch`)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('1');
  });

  it('adds the PICKED variation as its own line', async () => {
    renderAdd(cloth, [2, 3], blue);
    expect(screen.queryByText(`${K}.variantLater`)).not.toBeInTheDocument();
    await userEvent.click(addButton());
    expect(findSketchLine(readOrderDraft(), 5, 52)?.quantity).toBe('1');
    expect(findSketchLine(readOrderDraft(), 5, null)).toBeUndefined();
  });

  it('a product with ONE variation needs no pick — the generic target IS that variation', async () => {
    renderAdd({ ...cloth, variants: [red] }, [null, null]);
    expect(screen.queryByText(`${K}.variantLater`)).not.toBeInTheDocument();
    await userEvent.click(addButton());
    expect(findSketchLine(readOrderDraft(), 5, 51)?.quantity).toBe('1');
  });

  it('goes quiet for a combination nobody offers — the pick note above already says why', () => {
    renderAdd(cloth, [2, 4]);
    expect(addButton()).toBeDisabled();
    expect(screen.queryByText(`${K}.cap.today`)).not.toBeInTheDocument();
  });

  it('is disabled when nothing is takeable, and the hint says so for now or for the dates', () => {
    const { unmount } = render(
      <SketchDetailAdd product={{ ...base, available: 0 }} picks={[]} variant={undefined} />,
    );
    expect(addButton()).toBeDisabled();
    expect(screen.getByText(`${K}.cap.noneToday`)).toHaveClass('text-amber-700');
    unmount();

    saveOrderDraft({ ...pristineOrderValues(), deliveryAt: '2026-12-01T10:00' });
    renderAdd({ ...base, available: 0 });
    expect(screen.getByText(`${K}.cap.noneDated`)).toBeInTheDocument();
  });

  it('says nothing under the button when no figure measures the product and no variation is owed', () => {
    renderAdd(base);
    expect(addButton()).toBeEnabled();
    // The note is there (so a later hint can ease in) but holds nothing — and takes no room.
    expect(addButton().closest('.flex-col')?.lastElementChild).toHaveTextContent(/^$/);
  });

  it('holds the line: the stepper adjusts it, the trash takes it out, "Ver pedido" leaves for the form', async () => {
    saveOrderDraft({
      ...pristineOrderValues(),
      lines: [{ productId: 5, variantId: 52, pickedValues: [2, 3], quantity: '1', isRental: true }],
    });
    const navigateTo = renderAdd(cloth, [2, 3], blue);
    await userEvent.click(screen.getByRole('button', { name: `${STEP}.increase` }));
    expect(findSketchLine(readOrderDraft(), 5, 52)?.quantity).toBe('2');
    // Blue has 2: the stepper stops there.
    expect(screen.getByRole('button', { name: `${STEP}.atMax` })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: `${K}.view` }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos/nuevo');

    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), '1{Enter}');
    await userEvent.click(screen.getByRole('button', { name: `${STEP}.remove` }));
    expect(findSketchLine(readOrderDraft(), 5, 52)).toBeUndefined();
    expect(addButton()).toBeInTheDocument();
  });
});
