import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineAdjustmentsHorizontal,
  HiOutlineMagnifyingGlass,
  HiOutlineXMark,
} from 'react-icons/hi2';
import Button from '@components/Button';
import CustomInput from '@components/CustomInput';
import CustomSelect from '@components/CustomSelect';
import { SEARCH_DEBOUNCE_MS } from '@constants/Search';
import {
  hasActiveFilters,
  PRODUCT_LIST_ORDERS,
  PRODUCT_SEARCH_MAX_LENGTH,
  type ProductListSearch,
} from './productListSearch';
import { useProductCatalog } from './useProductCatalog';

const KEY = 'modules.panel.products.filters';

/**
 * How long typing settles before the search commits to the URL (and so to the query). Now the app's
 * ONE search debounce (`@constants/Search`), shared with the location picker so every search box in
 * the product has the same reflex. Re-exported for this module's existing consumers.
 */
export { SEARCH_DEBOUNCE_MS };

const CLEAR_COLOR = '#262626';
const PANEL_ID = 'products-filters-panel';

interface ProductsFilterBarProps {
  /** The committed filter state (the URL search params). */
  search: ProductListSearch;
  /** Commit a new filter state. `replace` avoids history spam for continuous input (typing). */
  onChange: (next: ProductListSearch, options?: { replace?: boolean }) => void;
}

/**
 * The catalog's filter toolbar, ONE composition at every width (owner decision, 2026-07-14 — it
 * replaced an inline-on-desktop variant): the **always-visible search** — the primary, most-used
 * filter — shares its row with a **"Filtros" toggle**, and the secondary selects (category /
 * business type / sort, all roles) live in a `grid-rows 0fr↔1fr` panel that eases open and closed.
 * The SORT is a single select with explicit combined options ("Nombre: A → Z", "Precio: menor a
 * mayor" — each states its own direction, no separate asc/desc switch to decode; the placeholder
 * IS the default, "Más recientes"). It replaced the old availability filter (owner decision,
 * 2026-07-15): availability means different things per role, while an ordering serves everyone. Keeping the search out of the panel is deliberate best practice: hiding
 * the highest-frequency control behind a click hurts discoverability; the facets are the part that
 * earns progressive disclosure. Hidden never means invisible: the toggle is badged with the active
 * select count, the panel starts open when a deep link arrives with a select filter set, and the
 * clear row sits OUTSIDE the panel so active filters stay evident and clearable while it's closed.
 *
 * Inside the panel the selects are an equal-width GRID (2-up on phones, 3-up from `sm`) spanning
 * the FULL row — like the search underline above them, the bar always reads as wide as the product
 * grid below (no arbitrary caps), and leftover space is shared instead of left as a dead gap. The
 * open panel also flips the toggle up the button emphasis scale (soft → solid) so "displayed" is
 * visibly distinct on the button itself.
 *
 * The component is CONTROLLED by the URL: `search` is the single committed truth, every change goes
 * through `onChange` (the page navigates). Typing commits with `replace: true` (one history entry
 * per *settled* search, not per keystroke); the discrete selects push, so the back button steps
 * through filter views. The panel's open/closed flag is local UI state — presentation, not a filter.
 *
 * Both collapses (the panel and the clear row) are ALWAYS-MOUNTED `grid-rows 0fr↔1fr` transitions
 * (the FormError doctrine; CSS — binary state, per the GSAP/CSS division rule), vertical on purpose:
 * a width tween inside a wrapping row can never be smooth (the browser re-wraps in one discrete
 * jump), while a dedicated row pushes the grid below gently. Their top spacing lives INSIDE the
 * clipped content, so the closed state costs zero height; while closed they're `inert` +
 * `aria-hidden` (unfocusable, invisible to assistive tech).
 */
const ProductsFilterBar: React.FC<ProductsFilterBarProps> = ({ search, onChange }) => {
  const { t } = useTranslation();
  const { data: catalog } = useProductCatalog();

  // The input is local state (it must not lag behind keystrokes); the URL is synced by the
  // debounce below. When the URL's `q` changes UNDER us (back button, clear filters) the input
  // re-syncs — unless the change is our own committed value, which would stomp in-progress typing
  // (e.g. a trailing space the normalization dropped). "Adjust state during render" pattern.
  const [qInput, setQInput] = useState(search.q ?? '');
  const [lastUrlQ, setLastUrlQ] = useState(search.q);
  if (search.q !== lastUrlQ) {
    setLastUrlQ(search.q);
    if ((search.q ?? '') !== qInput.trim().slice(0, PRODUCT_SEARCH_MAX_LENGTH)) {
      setQInput(search.q ?? '');
    }
  }

  /**
   * The single commit path (used by the debounce AND the Enter fast path) — **idempotent**, which
   * is what makes the two triggers race-free: a value equal to the committed URL value is a no-op
   * return, so Enter-then-timer (or Enter while the request is already in flight) can never fire a
   * second navigation, and React Query never sees a duplicate key change.
   */
  const commitSearch = (): void => {
    const normalized = qInput.trim().slice(0, PRODUCT_SEARCH_MAX_LENGTH);
    const target = normalized === '' ? undefined : normalized;
    if (target === search.q) return;
    onChange({ ...search, q: target }, { replace: true });
  };

  // Debounced commit: when the (normalized) input differs from the committed URL value, push it
  // after the typing settles. Any dependency change re-arms the timer; unmount cancels it — and an
  // Enter commit cancels it implicitly (the URL change re-runs this effect, its cleanup clears the
  // pending timer, and the equality guard above ends the new run immediately).
  useEffect(() => {
    const normalized = qInput.trim().slice(0, PRODUCT_SEARCH_MAX_LENGTH);
    const target = normalized === '' ? undefined : normalized;
    if (target === search.q) return;
    const timer = setTimeout(() => {
      onChange({ ...search, q: target }, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qInput, search, onChange]);

  /** A select change: `''` (the placeholder) clears that filter, anything else applies the id. */
  const selectValue = (raw: string): number | undefined => (raw === '' ? undefined : Number(raw));

  const categories = (catalog?.categories ?? []).map((option) => ({
    value: option.id,
    label: option.name,
  }));
  const businessTypes = (catalog?.businessTypes ?? []).map((option) => ({
    value: option.id,
    label: option.name,
  }));
  // Each option states its own direction in words — self-explanatory, nothing to decode.
  const sortOptions = PRODUCT_LIST_ORDERS.map((value) => ({
    value,
    label: t(`${KEY}.sortOptions.${value}`),
  }));

  const clearActive = hasActiveFilters(search);
  // How many SELECT states are non-default — the toggle's badge (the search is always visible, so
  // `q` doesn't count; the badge is what keeps hidden-but-active panel state evident). A
  // non-default sort counts too: it reshapes the list and clears with the same button.
  const selectFilterCount =
    (search.categoria === undefined ? 0 : 1) +
    (search.tipo === undefined ? 0 : 1) +
    (search.orden === undefined ? 0 : 1);

  // The panel starts open when a deep link already carries a select filter (arriving state should
  // be visible), and toggles freely afterwards. Local UI state — never in the URL.
  const [panelOpen, setPanelOpen] = useState(selectFilterCount > 0);

  return (
    <div role="search" aria-label={t(`${KEY}.label`)} className="pt-2">
      {/* The permanent row: search + the panel toggle, shoulder to shoulder at every width. The
          search underline runs the full row (no cap) so the bar reads as wide as the grid below,
          with the toggle pinned at the far right. */}
      <div className="flex items-end gap-x-4">
        <div className="min-w-0 flex-1">
          <CustomInput
            id="products-filter-q"
            label={t(`${KEY}.search`)}
            icon={<HiOutlineMagnifyingGlass />}
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
            onKeyDown={(event) => {
              // Enter = search NOW (don't wait out the debounce). Same idempotent commit path.
              if (event.key === 'Enter') {
                event.preventDefault();
                commitSearch();
              }
            }}
            maxLength={PRODUCT_SEARCH_MAX_LENGTH}
            autoComplete="off"
            type="search"
            optionalLabel={false}
          />
        </div>
        {/* Open panel = the button steps up the existing emphasis scale (soft → solid): clearly
            "on" in the app's own vocabulary, no bespoke active style; Button's built-in color
            transition makes the flip smooth. */}
        <Button
          variant={panelOpen ? 'solid' : 'soft'}
          color={CLEAR_COLOR}
          size="sm"
          startIcon={<HiOutlineAdjustmentsHorizontal className="size-4" />}
          onClick={() => setPanelOpen((open) => !open)}
          aria-expanded={panelOpen}
          aria-controls={PANEL_ID}
        >
          {selectFilterCount > 0
            ? t(`${KEY}.toggleWithCount`, { total: selectFilterCount })
            : t(`${KEY}.toggle`)}
        </Button>
      </div>
      {/* The selects panel: the FormError vertical collapse. Equal-width grid cells share the row
          (and any leftover space) instead of fixed widths leaving a dead gap; capped on very wide
          screens so a select never sprawls. Top spacing lives INSIDE the clipped content so a
          closed panel costs zero height. */}
      <div
        id={PANEL_ID}
        inert={!panelOpen}
        aria-hidden={!panelOpen}
        className={`grid transition-[grid-template-rows] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
          panelOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div
          className={`overflow-hidden transition-[opacity,translate] duration-300 ease-in-out motion-reduce:transition-none ${
            panelOpen ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
          }`}
        >
          <div className="grid grid-cols-2 items-end gap-x-5 gap-y-6 pt-6 sm:grid-cols-3">
            <CustomSelect
              id="products-filter-categoria"
              label={t(`${KEY}.category`)}
              options={categories}
              placeholderOption={t(`${KEY}.allFeminine`)}
              value={search.categoria ?? ''}
              disabled={!catalog}
              onChange={(event) => onChange({ ...search, categoria: selectValue(event.target.value) })}
            />
            <CustomSelect
              id="products-filter-tipo"
              label={t(`${KEY}.businessType`)}
              options={businessTypes}
              placeholderOption={t(`${KEY}.allMasculine`)}
              value={search.tipo ?? ''}
              disabled={!catalog}
              onChange={(event) => onChange({ ...search, tipo: selectValue(event.target.value) })}
            />
            <CustomSelect
              id="products-filter-orden"
              label={t(`${KEY}.sort`)}
              options={sortOptions}
              placeholderOption={t(`${KEY}.sortOptions.recientes`)}
              value={search.orden ?? ''}
              onChange={(event) => {
                const raw = event.target.value;
                onChange({
                  ...search,
                  orden: PRODUCT_LIST_ORDERS.find((value) => value === raw),
                });
              }}
            />
          </div>
        </div>
      </div>
      {/* The clear row: the same always-mounted vertical collapse, deliberately OUTSIDE the panel —
          active filters stay evident (and one-tap clearable) even while the panel is closed. */}
      <div
        inert={!clearActive}
        aria-hidden={!clearActive}
        className={`grid transition-[grid-template-rows] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
          clearActive ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div
          className={`overflow-hidden transition-[opacity,translate] duration-300 ease-in-out motion-reduce:transition-none ${
            clearActive ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
          }`}
        >
          <div className="pt-6">
            <Button
              variant="soft"
              color={CLEAR_COLOR}
              size="sm"
              startIcon={<HiOutlineXMark className="size-4" />}
              onClick={() => onChange({})}
            >
              {t(`${KEY}.clear`)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductsFilterBar;
