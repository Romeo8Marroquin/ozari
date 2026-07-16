import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The catalog feeds the category/type selects' options (the sort options are static).
const { useProductCatalog } = vi.hoisted(() => ({ useProductCatalog: vi.fn() }));
vi.mock('./useProductCatalog', () => ({ useProductCatalog }));

import type { ProductListSearch } from './productListSearch';
import ProductsFilterBar, { SEARCH_DEBOUNCE_MS } from './ProductsFilterBar';

const K = 'modules.panel.products.filters';

const catalog = {
  businessTypes: [
    { id: 1, name: 'Alquiler' },
    { id: 2, name: 'Venta' },
  ],
  categories: [{ id: 3, name: 'Mesas' }],
  currencies: [],
  detailTypes: [],
  rentTimeUnits: [],
};

const renderBar = (search: ProductListSearch = {}) => {
  const onChange = vi.fn();
  const utils = render(<ProductsFilterBar search={search} onChange={onChange} />);
  return { ...utils, onChange };
};

const panel = (): HTMLElement => document.getElementById('products-filters-panel')!;

beforeEach(() => {
  vi.useFakeTimers();
  useProductCatalog.mockReturnValue({ data: catalog });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ProductsFilterBar', () => {
  it('keeps the search visible and tucks the selects behind a closed Filtros panel', () => {
    const { onChange } = renderBar();
    expect(screen.getByLabelText(`${K}.search`)).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: `${K}.toggle` });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).toHaveAttribute('aria-hidden', 'true');

    // Open → the panel is announced and the selects are usable.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).toHaveAttribute('aria-hidden', 'false');
    fireEvent.change(screen.getByLabelText(`${K}.category`), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({ categoria: 3 });

    // Toggle closes again.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).toHaveAttribute('aria-hidden', 'true');
  });

  it('badges the toggle with the active SELECT count (sort included) and starts open on a deep link', () => {
    renderBar({ categoria: 3, tipo: 1, orden: 'precio-menor' });
    const toggle = screen.getByRole('button', { name: `${K}.toggleWithCount` });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).toHaveAttribute('aria-hidden', 'false');
  });

  it('does not count the search toward the badge (it is always visible) and keeps clear reachable', () => {
    const { onChange } = renderBar({ q: 'mesa' });
    // Plain label (no count), panel closed — but the CLEAR row is outside the panel and live.
    const toggle = screen.getByRole('button', { name: `${K}.toggle` });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: `${K}.clear` }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('disables the selects until the catalog resolves, then offers its options', () => {
    useProductCatalog.mockReturnValue({ data: undefined });
    const { rerender } = render(<ProductsFilterBar search={{}} onChange={vi.fn()} />);
    // Open the panel (options are only accessible while it isn't aria-hidden).
    fireEvent.click(screen.getByRole('button', { name: `${K}.toggle` }));
    expect(screen.getByLabelText(`${K}.category`)).toBeDisabled();
    expect(screen.getByLabelText(`${K}.businessType`)).toBeDisabled();

    useProductCatalog.mockReturnValue({ data: catalog });
    rerender(<ProductsFilterBar search={{}} onChange={vi.fn()} />);
    expect(screen.getByLabelText(`${K}.category`)).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Mesas' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Venta' })).toBeInTheDocument();
  });

  it('commits the search after the debounce, with replace (no history spam)', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByLabelText(`${K}.search`), { target: { value: 'mesa' } });

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ q: 'mesa' }, { replace: true });
  });

  it('re-arms the debounce on every keystroke (one commit for a settled value)', () => {
    const { onChange } = renderBar();
    const input = screen.getByLabelText(`${K}.search`);
    fireEvent.change(input, { target: { value: 'me' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 100);
    fireEvent.change(input, { target: { value: 'mesa' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ q: 'mesa' }, { replace: true });
  });

  it('commits immediately on Enter, and the pending debounce cannot double-fire', () => {
    const { onChange, rerender } = renderBar();
    const input = screen.getByLabelText(`${K}.search`);
    fireEvent.change(input, { target: { value: 'mesa' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ q: 'mesa' }, { replace: true });

    // The page navigates with the committed value; letting the old debounce window elapse after
    // that must NOT fire again (the URL change re-armed the effect into its no-op path).
    rerender(<ProductsFilterBar search={{ q: 'mesa' }} onChange={onChange} />);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores Enter when the input matches what is already committed (no re-trigger mid-search)', () => {
    const { onChange } = renderBar({ q: 'mesa' });
    const input = screen.getByLabelText(`${K}.search`);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Other keys never commit — only Enter is the fast path.
    fireEvent.keyDown(input, { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the committed search when Enter is pressed on an emptied input', () => {
    const { onChange } = renderBar({ q: 'mesa' });
    const input = screen.getByLabelText(`${K}.search`);
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({}, { replace: true });
  });

  it('never commits when the normalized input matches the committed value', () => {
    const { onChange } = renderBar();
    const input = screen.getByLabelText(`${K}.search`);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: '   ' } }); // normalizes to absent = committed state
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps in-progress typing when its own commit round-trips through the URL', () => {
    const { onChange, rerender } = renderBar();
    const input = screen.getByLabelText<HTMLInputElement>(`${K}.search`);
    fireEvent.change(input, { target: { value: 'mesa ' } }); // trailing space normalizes away
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ q: 'mesa' }, { replace: true });

    // The page navigates; the committed value comes back — the raw input must NOT be stomped.
    rerender(<ProductsFilterBar search={{ q: 'mesa' }} onChange={onChange} />);
    expect(input.value).toBe('mesa ');
  });

  it('re-syncs the input when the URL q changes under it (back button, clear)', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ProductsFilterBar search={{ q: 'mesa' }} onChange={onChange} />);
    const input = screen.getByLabelText<HTMLInputElement>(`${K}.search`);
    expect(input.value).toBe('mesa');

    rerender(<ProductsFilterBar search={{}} onChange={onChange} />);
    expect(input.value).toBe('');
  });

  it('applies a category / business type immediately, and clears it via the placeholder', () => {
    const { onChange, rerender } = renderBar();
    fireEvent.change(screen.getByLabelText(`${K}.category`), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({ categoria: 3 });

    fireEvent.change(screen.getByLabelText(`${K}.businessType`), { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith({ tipo: 1 });

    rerender(<ProductsFilterBar search={{ categoria: 3 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(`${K}.category`), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('offers the sort to EVERY role: applies, clears, and reflects the committed value', () => {
    const { onChange, rerender } = renderBar();
    const sort = screen.getByLabelText<HTMLSelectElement>(`${K}.sort`);

    // Each option is explicit about its own direction ("Precio: menor a mayor").
    fireEvent.change(sort, { target: { value: 'precio-menor' } });
    expect(onChange).toHaveBeenLastCalledWith({ orden: 'precio-menor' });
    fireEvent.change(sort, { target: { value: 'nombre-za' } });
    expect(onChange).toHaveBeenLastCalledWith({ orden: 'nombre-za' });

    // The placeholder IS the default ("Más recientes") — picking it clears the param.
    rerender(<ProductsFilterBar search={{ orden: 'precio-mayor' }} onChange={onChange} />);
    expect(screen.getByLabelText<HTMLSelectElement>(`${K}.sort`).value).toBe('precio-mayor');
    fireEvent.change(screen.getByLabelText(`${K}.sort`), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('offers "clear filters" only while a filter is active (collapsed but MOUNTED otherwise)', () => {
    const { onChange, rerender } = renderBar({ q: 'mesa' });
    fireEvent.click(screen.getByRole('button', { name: `${K}.clear` }));
    expect(onChange).toHaveBeenCalledWith({});

    // Inactive → the button leaves the a11y tree (aria-hidden + inert) but STAYS mounted, so its
    // grid-rows collapse can ease the space closed instead of popping the layout.
    rerender(<ProductsFilterBar search={{}} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: `${K}.clear` })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${K}.clear`, hidden: true })).toBeInTheDocument();
  });
});
