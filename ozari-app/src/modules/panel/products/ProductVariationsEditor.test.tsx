import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef } from 'react';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Small caps (the real 3 / 20 / 60 would render ~60 offered rows just to reach a limit — far too slow
// for a suite run in parallel). The editor and `productVariations` both read them, so they agree.
vi.mock('@constants/Regex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constants/Regex')>()),
  PRODUCT_MAX_OPTIONS: 2,
  PRODUCT_MAX_OPTION_VALUES: 3,
  PRODUCT_MAX_VARIANTS: 4,
}));

import { PRODUCT_IMAGE_MAX_TOTAL } from '@constants/Regex';
import type { Product, ProductImage, ProductVariant } from './product.types';
import ProductVariationsEditor from './ProductVariationsEditor';
import { emptyVariantRow, generateCombinations, type OptionFormRow } from './productVariations';
import {
  BUSINESS_TYPE_SELL,
  createProductDefaultValues,
  productToFormValues,
  type CreateProductFormType,
} from './SchemaCreateProduct';
import type { GalleryState } from './useGalleryImages';

const KEY = 'modules.panel.products.create.variations';

type Api = UseFormReturn<CreateProductFormType>;
const holder: { api?: Api; galleries?: Map<string, GalleryState> } = {};
const api = (): Api => {
  if (!holder.api) throw new Error('harness not mounted');
  return holder.api;
};
const values = (): CreateProductFormType => api().getValues();

const Harness: React.FC<{
  defaults?: Partial<CreateProductFormType>;
  product?: Product;
  showcaseCount?: number;
  disabled?: boolean;
}> = ({ defaults = {}, product, showcaseCount = 0, disabled = false }) => {
  const methods = useForm<CreateProductFormType>({
    defaultValues: product
      ? productToFormValues(product)
      : { ...createProductDefaultValues, ...defaults },
  });
  const galleries = useRef(new Map<string, GalleryState>());
  useEffect(() => {
    holder.api = methods;
    holder.galleries = galleries.current;
  });
  return (
    <FormProvider {...methods}>
      <ProductVariationsEditor
        disabled={disabled}
        product={product}
        galleries={galleries}
        showcaseCount={showcaseCount}
        progress={{}}
        isUploading={false}
      />
    </FormProvider>
  );
};

const colorOption = (names: string[]): OptionFormRow => ({
  name: 'Color',
  kind: 'generic',
  values: names.map((name, index) => ({ key: `n${index + 1}`, name, color: '' })),
});

/** The combination row (`<li>`) whose label reads `label`. */
const row = (label: string): HTMLElement => {
  const li = screen.getByText(label, { selector: 'span' }).closest('li');
  if (!li) throw new Error(`no row for ${label}`);
  return li;
};
const offerBox = (label: string): HTMLInputElement =>
  within(row(label)).getByRole('checkbox') as HTMLInputElement;
const buttons = (leaf: string): HTMLButtonElement[] =>
  screen.getAllByRole('button', { name: `${KEY}.actions.${leaf}` }) as HTMLButtonElement[];

beforeEach(() => {
  holder.api = undefined;
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

describe('ProductVariationsEditor — building options', () => {
  it('starts empty; an option and its first value offer the combination', async () => {
    render(<Harness />);
    expect(screen.getByText(`${KEY}.empty`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.photosTotal`)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.addOption` }));
    expect(screen.queryByText(`${KEY}.empty`)).not.toBeInTheDocument();
    expect(screen.getByText(`${KEY}.noCombinations`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.photosTotal`)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: `${KEY}.optionLabel` }), 'Color');

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.addValue` }));
    await userEvent.type(screen.getByRole('textbox', { name: `${KEY}.valueLabel` }), 'Rojo');

    expect(offerBox('Rojo')).toBeChecked();
    expect(screen.getByRole('textbox', { name: `${KEY}.quantityLabel · Rojo` })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${KEY}.combinationsHint`))).toBeInTheDocument();
    expect(values().variants.map((variant) => variant.valueKeys)).toHaveLength(1);
    expect(values().options[0].name).toBe('Color');
  });

  it('names an unnamed value with the fallback copy', async () => {
    render(<Harness defaults={{ options: [colorOption([''])], variants: [emptyVariantRow(['n1'])] }} />);
    expect(screen.getAllByText(`${KEY}.unnamedValue`, { selector: 'span' }).length).toBeGreaterThan(0);
  });

  it('moves values and options, and removes them with their variations', async () => {
    render(
      <Harness
        defaults={{
          options: [colorOption(['Rojo', 'Azul']), { name: 'Tamaño', kind: 'generic', values: [{ key: 'n3', name: 'Redondo', color: '' }] }],
          variants: [emptyVariantRow(['n1', 'n3']), emptyVariantRow(['n2', 'n3'])],
        }}
      />,
    );
    expect(buttons('moveOptionUp')[0]).toBeDisabled();
    expect(buttons('moveOptionDown')[1]).toBeDisabled();
    expect(buttons('moveValueEarlier')[0]).toBeDisabled();
    expect(buttons('moveValueLater')[1]).toBeDisabled();

    await userEvent.click(buttons('moveValueEarlier')[1]);
    expect(values().options[0].values.map((value) => value.name)).toEqual(['Azul', 'Rojo']);
    await userEvent.click(buttons('moveValueLater')[0]);
    expect(values().options[0].values.map((value) => value.name)).toEqual(['Rojo', 'Azul']);

    await userEvent.click(buttons('moveOptionDown')[0]);
    expect(values().options.map((option) => option.name)).toEqual(['Tamaño', 'Color']);
    await userEvent.click(buttons('moveOptionUp')[1]);
    expect(values().options.map((option) => option.name)).toEqual(['Color', 'Tamaño']);

    // Azul leaves → its variation leaves.
    await userEvent.click(buttons('removeValue')[1]);
    expect(values().variants.map((variant) => variant.valueKeys)).toEqual([['n1', 'n3']]);
    // Tamaño leaves → the variation collapses onto Color.
    await userEvent.click(buttons('removeOption')[1]);
    expect(values().variants.map((variant) => variant.valueKeys)).toEqual([['n1']]);
    // The last option leaves → back to a single stock.
    await userEvent.click(buttons('removeOption')[0]);
    expect(values().options).toEqual([]);
    expect(values().variants).toEqual([]);
    expect(screen.getByText(`${KEY}.empty`)).toBeInTheDocument();
  });

  it('withdraws and re-offers a combination, offers all, and marks one default', async () => {
    render(
      <Harness
        defaults={{
          options: [colorOption(['Rojo', 'Azul'])],
          variants: [emptyVariantRow(['n1']), emptyVariantRow(['n2'])],
        }}
      />,
    );
    const offerAll = screen.getByRole('button', { name: `${KEY}.actions.offerAll` });
    expect(offerAll).toBeDisabled();

    await userEvent.click(offerBox('Azul'));
    expect(offerBox('Azul')).not.toBeChecked();
    expect(within(row('Azul')).getByText(`${KEY}.notOffered`)).toBeInTheDocument();
    // A NEW (unsaved) row withdrawn says nothing about retiring or deleting.
    expect(screen.queryByText(`${KEY}.willDelete`)).not.toBeInTheDocument();
    expect(values().variants).toHaveLength(1);

    await userEvent.click(offerAll);
    expect(values().variants).toHaveLength(2);

    await userEvent.click(offerBox('Azul'));
    await userEvent.click(offerBox('Azul'));
    expect(offerBox('Azul')).toBeChecked();

    await userEvent.click(within(row('Azul')).getByRole('radio'));
    expect(values().variants.map((variant) => variant.isDefault)).toEqual([false, true]);
  });

  it('shows the rental fields with what each inherits', () => {
    render(
      <Harness
        defaults={{
          options: [colorOption(['Rojo'])],
          variants: [emptyVariantRow(['n1'])],
          rentPrice: '',
          securityDeposit: '20',
        }}
      />,
    );
    // No general price to inherit: the row's own price is what the line needs.
    expect(screen.getByRole('textbox', { name: `${KEY}.rentPriceLabel · Rojo` })).toHaveAttribute(
      'placeholder',
      `${KEY}.priceNeeded`,
    );
    expect(
      screen.getByRole('textbox', { name: `${KEY}.securityDepositLabel · Rojo` }),
    ).toHaveAttribute('placeholder', `${KEY}.inherit`);
    expect(screen.getByRole('textbox', { name: `${KEY}.replacementPriceLabel · Rojo` })).toHaveAttribute(
      'placeholder',
      `${KEY}.inheritNone`,
    );
    expect(screen.queryByRole('textbox', { name: `${KEY}.sellPriceLabel · Rojo` })).not.toBeInTheDocument();
  });

  it('shows only the sale price for Venta', () => {
    render(
      <Harness
        defaults={{
          businessTypeId: BUSINESS_TYPE_SELL,
          sellPrice: '50',
          options: [colorOption(['Rojo'])],
          variants: [emptyVariantRow(['n1'])],
        }}
      />,
    );
    expect(screen.getByRole('textbox', { name: `${KEY}.sellPriceLabel · Rojo` })).toHaveAttribute(
      'placeholder',
      `${KEY}.inherit`,
    );
    expect(screen.queryByRole('textbox', { name: `${KEY}.rentPriceLabel · Rojo` })).not.toBeInTheDocument();
  });

  it('holds every cap: options, values per option, variations (caps mocked to 2 / 3 / 4)', async () => {
    const color: OptionFormRow = {
      name: 'Color',
      kind: 'generic',
      values: ['Rojo', 'Azul', 'Verde'].map((name, index) => ({ key: `c${index}`, name, color: '' })),
    };
    const size: OptionFormRow = {
      name: 'Tamaño',
      kind: 'generic',
      values: ['Chico', 'Grande'].map((name, index) => ({ key: `s${index}`, name, color: '' })),
    };
    const options = [color, size];
    const combos = generateCombinations(options);
    render(
      <Harness
        defaults={{
          businessTypeId: BUSINESS_TYPE_SELL,
          options,
          variants: combos.slice(0, 3).map((combo) => emptyVariantRow(combo)),
        }}
      />,
    );
    expect(screen.getByRole('button', { name: `${KEY}.actions.addOption` })).toBeDisabled();
    expect(buttons('addValue')[0]).toBeDisabled();
    expect(buttons('addValue')[1]).toBeEnabled();

    // "Ofrecer todas" fills up to the cap and stops there.
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.offerAll` }));
    expect(values().variants).toHaveLength(4);
    expect(screen.getByRole('button', { name: `${KEY}.actions.offerAll` })).toBeDisabled();
    const unoffered = screen
      .getAllByRole('checkbox')
      .filter((box) => !(box as HTMLInputElement).checked);
    expect(unoffered.length).toBe(2);
    unoffered.forEach((box) => expect(box).toBeDisabled());

    // A value added at the cap joins its option but offers nothing more.
    await userEvent.click(buttons('addValue')[1]);
    expect(values().options[1].values).toHaveLength(3);
    expect(values().options[0].values).toHaveLength(3);
    expect(values().variants).toHaveLength(4);
  });

  it('keeps each option and combination row the same node across moves and renames', async () => {
    render(
      <Harness
        defaults={{
          options: [colorOption(['Rojo', 'Azul']), { name: 'Tamaño', kind: 'generic', values: [] }],
          variants: [emptyVariantRow(['n1']), emptyVariantRow(['n2'])],
        }}
      />,
    );
    // The options' fieldsets (the stock-mode fieldset follows them, outside the list).
    const [color, size] = screen.getAllByRole('group');
    const rojo = row('Rojo');
    await userEvent.click(buttons('moveOptionDown')[0]);
    expect(screen.getAllByRole('group').slice(0, 2)).toEqual([size, color]);
    await userEvent.click(buttons('moveOptionUp')[1]);

    // Tamaño's FIRST value completes every row: "Rojo" becomes "Rojo · Grande" — the same row.
    await userEvent.click(buttons('addValue')[1]);
    await userEvent.type(screen.getAllByRole('textbox', { name: `${KEY}.valueLabel` })[2], 'Grande');
    expect(row('Rojo · Grande')).toBe(rojo);
    expect(offerBox('Rojo · Grande')).toBeChecked();

    // Removing Tamaño folds them back: still the same row.
    await userEvent.click(buttons('removeOption')[1]);
    expect(row('Rojo')).toBe(rojo);
    expect(values().variants.map((variant) => variant.valueKeys)).toEqual([['n1'], ['n2']]);
  });

  it("empties a row's offer when its option loses its only value", async () => {
    render(
      <Harness
        defaults={{
          options: [colorOption(['Rojo']), { name: 'Tamaño', kind: 'generic', values: [{ key: 'n9', name: 'Grande', color: '' }] }],
          variants: [emptyVariantRow(['n1', 'n9'])],
        }}
      />,
    );
    const rojo = row('Rojo · Grande');
    await userEvent.click(buttons('removeValue')[1]);
    expect(row('Rojo')).toBe(rojo);
    expect(offerBox('Rojo')).not.toBeChecked();
    expect(values().variants).toEqual([]);
  });

  it('moves focus to a neighbour after a removal, else to the add button', async () => {
    render(
      <Harness
        defaults={{
          options: [colorOption(['Rojo', 'Azul']), { name: 'Tamaño', kind: 'generic', values: [{ key: 'n9', name: 'Grande', color: '' }] }],
          variants: [emptyVariantRow(['n1', 'n9'])],
        }}
      />,
    );
    // A value → the value before it.
    await userEvent.click(buttons('removeValue')[1]);
    expect(buttons('removeValue')[0]).toHaveFocus();
    // An option's last value → that option's "add value".
    await userEvent.click(buttons('removeValue')[1]);
    expect(buttons('addValue')[1]).toHaveFocus();
    // An option → the option after it.
    await userEvent.click(buttons('removeOption')[0]);
    expect(buttons('removeOption')[0]).toHaveFocus();
    // The last option → "add option".
    await userEvent.click(buttons('removeOption')[0]);
    expect(screen.getByRole('button', { name: `${KEY}.actions.addOption` })).toHaveFocus();
  });

  it('disables every control while the form is busy', () => {
    render(
      <Harness
        disabled
        defaults={{ options: [colorOption(['Rojo'])], variants: [emptyVariantRow(['n1'])] }}
      />,
    );
    expect(screen.getByRole('button', { name: `${KEY}.actions.addOption` })).toBeDisabled();
    expect(buttons('removeOption')[0]).toBeDisabled();
    expect(offerBox('Rojo')).toBeDisabled();
    expect(within(row('Rojo')).getByRole('radio')).toBeDisabled();
  });
});

describe('ProductVariationsEditor — errors', () => {
  const defaults = { options: [colorOption(['Rojo'])], variants: [emptyVariantRow(['n1'])] };

  it('shows an option-values error under its option', async () => {
    render(<Harness defaults={defaults} />);
    act(() => api().setError('options.0.values', { type: 'custom', message: 'sin valores' }));
    expect(await screen.findByText('sin valores', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows the options-level error', async () => {
    render(<Harness defaults={defaults} />);
    act(() => api().setError('options', { type: 'custom', message: 'demasiadas opciones' }));
    expect(await screen.findByText('demasiadas opciones', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("shows a variations error from the array's root and a row's combination error", async () => {
    render(<Harness defaults={defaults} />);
    // RHF's path type has no `root` on an array field, though the resolver writes one there.
    act(() => api().setError('variants.root' as 'variants', { type: 'custom', message: 'sin variaciones' }));
    expect(await screen.findByText('sin variaciones', {}, { timeout: 5000 })).toBeInTheDocument();
    act(() => api().setError('variants.0.valueKeys', { type: 'custom', message: 'combinación rota' }));
    expect(await screen.findByText('combinación rota', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('ProductVariationsEditor — a COLOR option', () => {
  const kindSelect = (index: number) => document.getElementById(`product-option-kind-${index}`) as HTMLSelectElement;
  const kinds = (index: number) => Array.from(kindSelect(index).options).map((option) => option.value);

  it('names an unnamed option "Color" and opens a swatch beside each value', async () => {
    render(<Harness defaults={{ options: [{ ...colorOption(['Marfil']), name: '' }], variants: [emptyVariantRow(['n1'])] }} />);
    const valueBox = screen.getByRole('textbox', { name: `${KEY}.valueLabel` });
    expect(valueBox).toHaveAttribute('placeholder', `${KEY}.valuePlaceholder`);
    // Closed while generic: hidden from assistive tech and out of the tab order.
    const slot = screen.getByLabelText(`${KEY}.pickColor`).closest('[aria-hidden]');
    expect(slot).toHaveAttribute('aria-hidden', 'true');

    await userEvent.selectOptions(kindSelect(0), 'color');
    expect(values().options[0]).toMatchObject({ kind: 'color', name: `${KEY}.colorOptionName` });
    expect(valueBox).toHaveAttribute('placeholder', `${KEY}.colorValuePlaceholder`);
    expect(slot).toHaveAttribute('aria-hidden', 'false');

    // Not picked yet: the native input shows black, the FORM keeps '' (required).
    const picker = screen.getByLabelText(`${KEY}.pickColor`) as HTMLInputElement;
    expect(picker.value).toBe('#000000');
    expect(picker.closest('label')).not.toHaveAttribute('title');
    fireEvent.input(picker, { target: { value: '#fffff0' } });
    expect(values().options[0].values[0].color).toBe('#fffff0');
    expect(picker.closest('label')).toHaveAttribute('title', '#fffff0');
    expect(picker.closest('label')).toHaveStyle({ backgroundColor: '#fffff0' });
  });

  it('keeps a typed name when switching to Color, and lists Color only where it can be chosen', async () => {
    render(
      <Harness
        defaults={{
          options: [
            { name: 'Tono', kind: 'color', values: [{ key: 'n1', name: 'Marfil', color: '#FFFFF0' }] },
            { name: 'Tamaño', kind: 'generic', values: [{ key: 'n2', name: 'Grande', color: '' }] },
          ],
          variants: [emptyVariantRow(['n1', 'n2'])],
        }}
      />,
    );
    // The color option keeps Color; the other cannot take a second one.
    expect(kinds(0)).toEqual(['generic', 'color']);
    expect(kinds(1)).toEqual(['generic']);
    await userEvent.selectOptions(kindSelect(0), 'generic');
    expect(kinds(1)).toEqual(['generic', 'color']);
    await userEvent.selectOptions(kindSelect(0), 'color');
    expect(values().options[0].name).toBe('Tono');
  });

  it('flags a missing colour on its ring and under the value', async () => {
    render(
      <Harness
        defaults={{
          options: [{ name: 'Color', kind: 'color', values: [{ key: 'n1', name: 'Marfil', color: '' }] }],
          variants: [emptyVariantRow(['n1'])],
        }}
      />,
    );
    act(() => api().setError('options.0.values.0.color', { type: 'custom', message: 'elige un color' }));
    expect(await screen.findByText('elige un color', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByLabelText(`${KEY}.pickColor`)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('ProductVariationsEditor — stock mode', () => {
  const defaults = { options: [colorOption(['Rojo'])], variants: [emptyVariantRow(['n1'])] };
  const radio = (leaf: string) =>
    screen.getByRole('radio', { name: `${KEY}.stockMode.${leaf}`, description: `${KEY}.stockMode.${leaf}Hint` });

  it('moves the stock off the rows when the variations share one', async () => {
    render(<Harness defaults={defaults} />);
    expect(radio('perVariant')).toBeChecked();
    expect(screen.getByRole('textbox', { name: `${KEY}.quantityLabel · Rojo` })).toBeInTheDocument();

    await userEvent.click(radio('shared'));
    expect(values().sharedStock).toBe(true);
    expect(await screen.findByText(`${KEY}.stockMode.sharedCell`)).toBeInTheDocument();
  });

  it('re-checks both quantity sides once the form has been submitted', async () => {
    render(<Harness defaults={defaults} />);
    await act(() => api().handleSubmit(() => {})());
    act(() => api().setError('variants.0.quantity', { type: 'custom', message: 'cantidad' }));
    expect(api().getFieldState('variants.0.quantity').error).toBeDefined();
    // A stale per-row message must not survive the row losing its quantity.
    await userEvent.click(radio('shared'));
    await waitFor(() => expect(api().getFieldState('variants.0.quantity').error).toBeUndefined());
  });
});

describe('ProductVariationsEditor — a saved product', () => {
  const image = (id: number): ProductImage => ({
    id,
    url: `https://cdn/${id}.webp`,
    isPrimary: id === 1,
    sortOrder: id,
  });
  const variant = (
    id: number,
    valueId: number,
    label: string,
    usage: { lines: number; holding: number } | undefined,
    quantity = 1,
  ): ProductVariant => ({
    id,
    valueIds: [valueId],
    label,
    isDefault: false,
    quantity,
    overrides: {},
    usage,
  });
  const product: Product = {
    id: 7,
    name: 'Mantel',
    description: 'Mantel de tela',
    businessType: 'Alquiler',
    businessTypeId: 1,
    category: 'Mantelería',
    categoryId: 1,
    currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
    rentPrice: 25,
    rentTimeUnitId: 2,
    inStock: true,
    available: 12,
    total: 12,
    isActive: true,
    images: [],
    details: [],
    options: [
      {
        id: 1,
        name: 'Color',
        sortOrder: 0,
        kind: 'generic' as const,
        values: [
          { id: 1, name: 'Rojo', sortOrder: 0, images: [image(1), image(2)] },
          { id: 2, name: 'Azul', sortOrder: 1, images: [] },
          { id: 3, name: 'Verde', sortOrder: 2, images: [] },
          { id: 4, name: 'Blanco', sortOrder: 3, images: [] },
        ],
      },
    ],
    variants: [
      variant(10, 1, 'Rojo', { lines: 4, holding: 2 }),
      variant(11, 2, 'Azul', { lines: 3, holding: 0 }, 5),
      variant(12, 3, 'Verde', { lines: 0, holding: 0 }),
      // No `usage` reported → the UI says nothing (it never guesses the server's consequence).
      variant(13, 4, 'Blanco', undefined),
    ],
  };

  it('blocks every door that would drop a variation still holding stock', () => {
    render(<Harness product={product} />);
    expect(offerBox('Rojo')).toBeDisabled();
    expect(within(row('Rojo')).getByText(`${KEY}.holding`)).toBeInTheDocument();
    expect(buttons('removeValue')[0]).toBeDisabled();
    expect(buttons('removeValue')[0]).toHaveAttribute('title', `${KEY}.blockedRemoval`);
    expect(buttons('removeValue')[1]).toBeEnabled();
    expect(buttons('removeValue')[1]).not.toHaveAttribute('title');
    expect(buttons('removeOption')[0]).toBeDisabled();
    expect(buttons('removeOption')[0]).toHaveAttribute('title', `${KEY}.blockedRemoval`);
  });

  it("says what the server will do with a withdrawn saved variation, and restores it when re-offered", async () => {
    render(<Harness product={product} />);
    expect(screen.queryByText(`${KEY}.pendingRetire`)).not.toBeInTheDocument();

    await userEvent.click(offerBox('Azul'));
    expect(within(row('Azul')).getByText(`${KEY}.willRetire`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.pendingRetire`)).toBeInTheDocument();

    await userEvent.click(offerBox('Verde'));
    expect(within(row('Verde')).getByText(`${KEY}.willDelete`)).toBeInTheDocument();

    await userEvent.click(offerBox('Blanco'));
    expect(within(row('Blanco')).queryByText(`${KEY}.willDelete`)).not.toBeInTheDocument();
    expect(within(row('Blanco')).queryByText(`${KEY}.willRetire`)).not.toBeInTheDocument();

    // Re-offered: the SAME variation comes back (id, stock), not a fresh one.
    await userEvent.click(offerBox('Azul'));
    expect(values().variants.find((entry) => entry.id === 11)).toMatchObject({ quantity: '5' });
    expect(screen.queryByText(`${KEY}.pendingRetire`)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.offerAll` }));
    expect(values().variants.map((entry) => entry.id).sort()).toEqual([10, 11, 12, 13]);
  });

  it("counts each value's photos toward the product total and toggles its panel", async () => {
    render(<Harness product={product} showcaseCount={PRODUCT_IMAGE_MAX_TOTAL - 1} />);
    const toggles = screen.getAllByRole('button', { name: `${KEY}.photosToggle` });
    expect(within(toggles[0]).getByText('2')).toBeInTheDocument();
    // (total − 1) showcase + 2 on Rojo = total + 1 → the total turns red.
    expect(screen.getByText(`${KEY}.photosTotal`)).toHaveClass('font-semibold');

    expect(toggles[1]).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggles[1]);
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggles[1]);
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'false');
  });

  it("registers each value's gallery by key, and unregisters it when the value leaves", async () => {
    render(<Harness product={product} />);
    const inputs = document.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[1], {
      target: { files: [new File(['x'], 'azul.png', { type: 'image/png' })] },
    });
    await screen.findByAltText('azul.png');
    expect(holder.galleries?.get('v2')?.images).toHaveLength(1);
    expect(holder.galleries?.get('v1')?.images).toHaveLength(2);
    expect(within(screen.getAllByRole('button', { name: `${KEY}.photosToggle` })[1]).getByText('1')).toBeInTheDocument();

    await userEvent.click(buttons('removeValue')[1]);
    expect(holder.galleries?.has('v2')).toBe(false);
  });
});
