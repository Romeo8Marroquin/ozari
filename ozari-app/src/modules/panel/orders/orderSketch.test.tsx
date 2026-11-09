import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@api/client', () => ({ api: { post } }));

const { useHasRole } = vi.hoisted(() => ({ useHasRole: vi.fn(() => true) }));
vi.mock('@hooks/useRole', () => ({ getStoredUserId: () => 1, useHasRole }));

import { StorageKeys } from '@constants/StorageKeys';
import { PRODUCT_MAX_QUANTITY } from '@constants/Regex';
import { Storage } from '@utils/storage';
import type { Product, ProductVariant } from '../products/product.types';
import { saveOrderDraft } from './orderDraft';
import {
  addToSketch,
  findSketchLine,
  genericTarget,
  lineQuantity,
  pristineOrderValues,
  setSketchQuantity,
  sketchCount,
  sketchLineCap,
  sketchLines,
  sketchWindow,
  useOrderSketch,
  useSketchAvailability,
  withWindowStock,
  type SketchLine,
} from './orderSketch';
import { createOrderDefaultValues, type CreateOrderFormType } from './SchemaCreateOrder';

const chair: Product = {
  id: 3,
  name: 'Silla',
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Sillas',
  categoryId: 1,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 6,
  images: [],
  details: [],
  available: 10,
  total: 12,
  inStock: true,
};

const variant = (id: number, valueIds: number[], available: number): ProductVariant => ({
  id,
  valueIds,
  label: `v${id}`,
  isDefault: id === 71,
  available,
  inStock: available > 0,
});

/** A tablecloth: Color (Rojo 1, Azul 2). Each colour its own stock (8 in all). */
const cloth: Product = {
  ...chair,
  id: 7,
  name: 'Mantel',
  available: 8,
  options: [
    {
      id: 10,
      name: 'Color',
      sortOrder: 0,
      kind: 'generic',
      values: [
        { id: 1, name: 'Rojo', sortOrder: 0, images: [] },
        { id: 2, name: 'Azul', sortOrder: 1, images: [] },
      ],
    },
  ],
  variants: [variant(71, [1], 5), variant(72, [2], 3)],
};

const sale: Product = { ...chair, id: 4, name: 'Vasos', businessType: 'Venta', businessTypeId: 2 };

const line = (over: Partial<SketchLine>): SketchLine => ({
  productId: 3,
  variantId: null,
  pickedValues: [],
  quantity: '1',
  isRental: true,
  ...over,
});

const stored = (): CreateOrderFormType | null =>
  Storage.get<CreateOrderFormType>(StorageKeys.ORDER_CREATE_DRAFT);

beforeEach(() => {
  localStorage.clear();
  post.mockReset();
  useHasRole.mockReturnValue(true);
});

afterEach(() => {
  localStorage.clear();
});

describe('the sketch store', () => {
  it('builds on the SAME blank order the form opens with (assignee = the signed-in admin)', () => {
    expect(pristineOrderValues()).toEqual({ ...createOrderDefaultValues, assignedUserId: 1 });
  });

  it('follows every write live, and keeps ONE snapshot per stored text', () => {
    const { result } = renderHook(() => useOrderSketch());
    expect(result.current).toBeNull();
    act(() => {
      addToSketch(chair, null, [], undefined);
    });
    const first = result.current;
    expect(sketchCount(first)).toBe(1);
    expect(first?.assignedUserId).toBe(1);
    // A re-render with nothing changed hands back the very same object (useSyncExternalStore).
    expect(renderHook(() => useOrderSketch()).result.current).toBe(first);
  });

  it('counts the lines that NAME a product — a blank row is not in the cart', () => {
    const sketch = { ...pristineOrderValues(), lines: [line({}), line({ productId: null as unknown as number })] };
    expect(sketchLines(sketch)).toHaveLength(1);
    expect(sketchCount(sketch)).toBe(1);
    expect(sketchCount(null)).toBe(0);
    expect(lineQuantity(undefined)).toBe(0);
    expect(lineQuantity(line({ quantity: '' }))).toBe(0);
    expect(findSketchLine(null, 3, null)).toBeUndefined();
  });

  it('adds a product generically, then one more each time, never past the cap', () => {
    expect(addToSketch(chair, null, [], 2)).toBe(1);
    expect(stored()?.lines).toEqual([line({ quantity: '1' })]);
    expect(addToSketch(chair, null, [], 2)).toBe(2);
    // At the cap: nothing is written, and the answer is what it already holds.
    expect(addToSketch(chair, null, [], 2)).toBe(2);
    expect(stored()?.lines[0]?.quantity).toBe('2');
    // A sale line is no rental.
    addToSketch(sale, null, [], undefined);
    expect(findSketchLine(stored(), 4, null)?.isRental).toBe(false);
  });

  it('adds nothing at all when nothing is takeable', () => {
    expect(addToSketch(chair, null, [], 0)).toBe(0);
    expect(stored()).toBeNull();
  });

  it('never exceeds the order quantity ceiling, even with no cap known', () => {
    saveOrderDraft({ ...pristineOrderValues(), lines: [line({ quantity: String(PRODUCT_MAX_QUANTITY) })] });
    expect(addToSketch(chair, null, [], undefined)).toBe(PRODUCT_MAX_QUANTITY);
    setSketchQuantity(3, null, PRODUCT_MAX_QUANTITY + 50);
    expect(stored()?.lines[0]?.quantity).toBe(String(PRODUCT_MAX_QUANTITY));
  });

  it('adds a VARIATION with its picks, and a generic line with the PARTIAL picks made so far', () => {
    addToSketch(cloth, 72, [2], undefined);
    expect(findSketchLine(stored(), 7, 72)).toEqual(
      line({ productId: 7, variantId: 72, pickedValues: [2], quantity: '1' }),
    );
    addToSketch(cloth, null, [1], undefined);
    expect(findSketchLine(stored(), 7, null)?.pickedValues).toEqual([1]);
    expect(sketchCount(stored())).toBe(2);
  });

  it('reads a generic add of a ONE-variation product as that variation — nothing to choose', () => {
    expect(genericTarget(chair)).toEqual({ variantId: null, pickedValues: [] });
    expect(genericTarget(cloth)).toEqual({ variantId: null, pickedValues: [] });
    const single = { ...cloth, variants: [variant(71, [1], 5)] };
    expect(genericTarget(single)).toEqual({ variantId: 71, pickedValues: [1] });
  });

  it('sets a quantity, takes a line out at zero, and forgets an EMPTY sketch entirely', () => {
    setSketchQuantity(3, null, 2); // no sketch at all — nothing to set, nothing written
    expect(stored()).toBeNull();
    addToSketch(chair, null, [], undefined);
    addToSketch(sale, null, [], undefined);
    setSketchQuantity(3, null, 5);
    expect(findSketchLine(stored(), 3, null)?.quantity).toBe('5');
    setSketchQuantity(9, null, 2); // not in the sketch — nothing happens
    setSketchQuantity(3, null, 0);
    expect(findSketchLine(stored(), 3, null)).toBeUndefined();
    setSketchQuantity(4, null, 0);
    // Nothing left but a pristine order: no residue, the header empties.
    expect(stored()).toBeNull();
  });

  it('keeps the REST of the order when the last line goes — the dates are still work', () => {
    saveOrderDraft({ ...pristineOrderValues(), deliveryName: 'María', lines: [line({})] });
    setSketchQuantity(3, null, 0);
    expect(stored()).toMatchObject({ deliveryName: 'María', lines: [] });
  });
});

describe('sketchLineCap', () => {
  const none = new Map<string, number | null>();

  it('is unknown when nothing measures the product', () => {
    expect(sketchLineCap({ ...chair, available: undefined }, null, [], none)).toBeUndefined();
  });

  it('a generic line draws on the WHOLE product — every other line of it counts against it', () => {
    const lines = [line({ productId: 7, variantId: 71, quantity: '3' }), line({ productId: 7, quantity: '1' })];
    expect(sketchLineCap(cloth, null, lines, none)).toBe(8 - 3);
    // Other products never count.
    expect(sketchLineCap(chair, null, [line({ productId: 4, quantity: '9' })], none)).toBe(10);
  });

  it('a variation draws on its own units, less a generic line that may become it, and never past the product', () => {
    const lines = [
      line({ productId: 7, variantId: 71, quantity: '2' }),
      line({ productId: 7, quantity: '1' }),
      line({ productId: 7, variantId: 72, quantity: '1' }),
    ];
    // Rojo: 5 − the generic 1 (Azul is not its stock) = 4; the product: 8 − (1 + 1) = 6.
    expect(sketchLineCap(cloth, 71, lines, none)).toBe(4);
    // The product as a whole binds when it is the tighter one.
    const tight = { ...cloth, available: 3 };
    expect(sketchLineCap(tight, 71, lines, none)).toBe(1);
    // A product carrying no own figure leaves the variation's.
    expect(sketchLineCap({ ...cloth, available: undefined }, 71, lines, none)).toBe(4);
  });

  it('with SHARED stock every variation draws on one pool', () => {
    const shared = { ...cloth, sharedStock: true, variants: [variant(71, [1], 8), variant(72, [2], 8)] };
    const lines = [line({ productId: 7, variantId: 72, quantity: '5' })];
    expect(sketchLineCap(shared, 71, lines, none)).toBe(3);
  });

  it('reads the WINDOW figure first, and never goes below zero', () => {
    const windowed = new Map<string, number | null>([['3:', 2]]);
    expect(sketchLineCap(chair, null, [line({ quantity: '9' })], windowed)).toBe(2);
    expect(sketchLineCap(chair, null, [line({ quantity: '9' }), line({ quantity: '4' })], windowed)).toBe(0);
  });
});

describe('the sketch window', () => {
  it('exists once there is a usable delivery date; the pickup is optional', () => {
    expect(sketchWindow(null)).toBeNull();
    expect(sketchWindow({ ...pristineOrderValues(), deliveryAt: 'nope' })).toBeNull();
    const sale = sketchWindow({ ...pristineOrderValues(), deliveryAt: '2026-12-01T10:00' });
    expect(sale?.pickupAt).toBeNull();
    const rental = sketchWindow({
      ...pristineOrderValues(),
      deliveryAt: '2026-12-01T10:00',
      pickupAt: '2026-12-02T10:00',
    });
    expect(rental?.pickupAt).toBeInstanceOf(Date);
  });

  it('rewrites the stock figures with the window’s, per variation, and leaves the rest alone', () => {
    expect(withWindowStock(cloth, new Map())).toBe(cloth);
    const client = { ...cloth, available: undefined };
    expect(withWindowStock(client, new Map([['7:', 1]]))).toBe(client);

    const windowed = withWindowStock(
      cloth,
      new Map<string, number | null>([
        ['7:', 2],
        ['7:71', 0],
        ['7:72', null],
      ]),
    );
    expect(windowed).toMatchObject({ available: 2, inStock: true });
    expect(windowed.variants?.[0]).toMatchObject({ id: 71, available: 0, inStock: false });
    // `null` = a rental with no pickup yet: today's figure stands.
    expect(windowed.variants?.[1]).toBe(cloth.variants?.[1]);
    expect(windowed.images).toBe(cloth.images);

    // A product without variations; and a product whose own figure the probe left unknown.
    expect(withWindowStock(chair, new Map([['3:', 0]]))).toMatchObject({ available: 0, inStock: false });
    expect(withWindowStock(chair, new Map([['3:', null]])).available).toBe(10);
  });
});

describe('useSketchAvailability', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );

  it('asks nothing until the sketch has a delivery date', () => {
    const { result } = renderHook(() => useSketchAvailability([3]), { wrapper });
    expect(result.current.window).toBeNull();
    expect(result.current.availability.size).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('probes the sketch’s window for the products asked about — once each, in order', async () => {
    saveOrderDraft({
      ...pristineOrderValues(),
      deliveryAt: '2026-12-01T10:00',
      pickupAt: '2026-12-02T10:00',
    });
    post.mockResolvedValue({
      data: { data: { availability: [{ productId: 7, available: 4, variants: [{ variantId: 71, available: 1 }] }] } },
    });
    const { result } = renderHook(() => useSketchAvailability([7, 3, 7]), { wrapper });
    await waitFor(() => expect(result.current.availability.get('7:71')).toBe(1));
    expect(result.current.window?.pickupAt).toBeInstanceOf(Date);
    const [url, body, config] = post.mock.calls[0] as [string, Record<string, unknown>, Record<string, unknown>];
    expect(url).toBe('/orders/availability');
    expect(body.productIds).toEqual([3, 7]);
    expect(body.pickupAt).toBeDefined();
    // Advisory: a failure must stay silent.
    expect(config).toEqual({ skipErrorNotification: true });
  });

  it('a SALE window carries no pickup, and an empty answer is an empty map', async () => {
    saveOrderDraft({ ...pristineOrderValues(), deliveryAt: '2026-12-01T10:00' });
    post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSketchAvailability([4]), { wrapper });
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0] as [string, Record<string, unknown>])[1]).not.toHaveProperty('pickupAt');
    expect(result.current.availability.size).toBe(0);
  });

  it('is the Admin’s only — anybody else gets today’s stock and no window', () => {
    useHasRole.mockReturnValue(false);
    saveOrderDraft({ ...pristineOrderValues(), deliveryAt: '2026-12-01T10:00' });
    const { result } = renderHook(() => useSketchAvailability([3]), { wrapper });
    expect(result.current.window).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});
