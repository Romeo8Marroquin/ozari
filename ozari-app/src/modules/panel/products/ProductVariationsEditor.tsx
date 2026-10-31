import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineChevronDown,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineChevronUp,
  HiOutlinePhoto,
  HiOutlinePlus,
  HiOutlineSwatch,
  HiOutlineTrash,
} from 'react-icons/hi2';
import AnimatedMessage from '@components/AnimatedMessage';
import Button from '@components/Button';
import Collapse from '@components/Collapse';
import CustomInputForm from '@components/CustomInputForm';
import CustomSelect from '@components/CustomSelect';
import {
  PRODUCT_IMAGE_MAX_TOTAL,
  PRODUCT_MAX_OPTION_VALUES,
  PRODUCT_MAX_OPTIONS,
  PRODUCT_MAX_VARIANTS,
  PRODUCT_OPTION_VALUE_IMAGE_MAX_COUNT,
} from '@constants/Regex';
import { decimalInput, integerInput } from '@utils/numericInput';
import SlotSwap from '../SlotSwap';
import useListMotion from '../useListMotion';
import type { Product, ProductImage, ProductOptionKind, ProductVariantUsage } from './product.types';
import ProductImageGallery from './ProductImageGallery';
import {
  addValueCombinations,
  allValueKeys,
  carryRowKeys,
  COLOR_HEX_REGEX,
  combinationOf,
  dropOptionFromVariants,
  dropValueFromVariants,
  emptyVariantRow,
  generateCombinations,
  mintValueKey,
  OPTION_KINDS,
  rowKeyOf,
  valueKeyForId,
  variantLabelFor,
  type OptionFormRow,
  type VariantFormRow,
} from './productVariations';
import { BUSINESS_TYPE_RENT, type CreateProductFormType } from './SchemaCreateProduct';
import { useGalleryImages, type GalleryState } from './useGalleryImages';

const KEY = 'modules.panel.products.create.variations';
const SECONDARY_COLOR = '#262626';
const ICON_BUTTON =
  'grid size-9 shrink-0 cursor-pointer place-items-center rounded-chip text-charcoal/45 transition-[color,background-color,box-shadow] duration-200 hover:bg-charcoal/[0.05] hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent';
const DANGER_BUTTON = `${ICON_BUTTON} hover:bg-red-50 hover:text-red-600`;
/**
 * Past this many combination rows a structural move stops animating them one by one (a third
 * option's value can list hundreds): the option or value itself still leaves or glides, the rows
 * simply settle. Measured against the work, not the eye — dozens of rows still move.
 */
const ROW_MOTION_CAP = 80;

/** Maps a listed combination to what it becomes after a structural change (`null` = it leaves). */
type Projection = (valueKeys: readonly string[]) => readonly string[] | null;

/** The combinations the editor lists: over the options that HAVE values (option order). */
const combinationsOf = (options: OptionFormRow[]): string[][] =>
  generateCombinations(options.filter((option) => option.values.length > 0));

/** Removing value `key`: from an option that keeps other values, every combination using it leaves;
 *  from an option it was the ONLY value of, every combination simply loses it. */
const valueRemoval = (key: string, alone: boolean): Projection =>
  alone ? (combo) => combo.filter((entry) => entry !== key) : (combo) => (combo.includes(key) ? null : combo);

/** The `n`th option's on-screen identity — stable across moves, so its fieldset travels with it. */
let optionUidCounter = 0;
const mintOptionUid = (): string => {
  optionUidCounter += 1;
  return `o${optionUidCounter}`;
};

/** An RHF error node's message, wherever the resolver put it (a leaf, or an array's `root`). */
const messageOf = (node: unknown): string | undefined => {
  const error = node as { message?: string; root?: { message?: string } } | undefined;
  return error?.message ?? error?.root?.message;
};

/**
 * An option's TYPE select (owner 2026-10-30): `Genérica` for any axis, `Color` for the one axis whose
 * values carry a real colour. A product has at most one color option, so `Color` is only listed where
 * it can be chosen (this option already is one, or no other is). Picking `Color` on an unnamed option
 * names it "Color" — the name the admin would have typed anyway.
 */
const OptionKindSelect: React.FC<{
  optionIndex: number;
  colorAllowed: boolean;
  disabled: boolean;
}> = ({ optionIndex, colorAllowed, disabled }) => {
  const { t } = useTranslation();
  const { control, getValues, setValue } = useFormContext<CreateProductFormType>();
  return (
    <Controller
      control={control}
      name={`options.${optionIndex}.kind`}
      render={({ field }) => (
        <CustomSelect
          id={`product-option-kind-${optionIndex}`}
          name={field.name}
          ref={field.ref}
          label={t(`${KEY}.kindLabel`)}
          disabled={disabled}
          value={field.value}
          onBlur={field.onBlur}
          onChange={(event) => {
            const kind = event.target.value as ProductOptionKind;
            field.onChange(kind);
            if (kind === 'color' && getValues(`options.${optionIndex}.name`).trim() === '') {
              setValue(`options.${optionIndex}.name`, t(`${KEY}.colorOptionName`), { shouldDirty: true });
            }
          }}
          options={OPTION_KINDS.filter((kind) => kind !== 'color' || colorAllowed || field.value === 'color').map(
            (kind) => ({ value: kind, label: t(`${KEY}.kinds.${kind}`) }),
          )}
        />
      )}
    />
  );
};

/**
 * A color value's SWATCH: the picked colour as a circle that opens the platform's colour picker (a
 * real `<input type="color">` stretched invisibly over it — keyboard, screen readers and every
 * mobile picker come for free). Not picked yet = a dashed ring with a swatch glyph. Its slot eases
 * open and shut horizontally as the option switches kind (the `Collapse` recipe on the other axis),
 * so the value's name field slides over instead of jumping.
 */
const ValueColorSlot: React.FC<{
  optionIndex: number;
  valueIndex: number;
  open: boolean;
  valueName: string;
  disabled: boolean;
}> = ({ optionIndex, valueIndex, open, valueName, disabled }) => {
  const { t } = useTranslation();
  const { control } = useFormContext<CreateProductFormType>();
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={`grid shrink-0 pt-1.5 transition-[grid-template-columns,opacity,margin] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
        open ? 'grid-cols-[1fr] opacity-100' : '-mr-2 grid-cols-[0fr] opacity-0'
      }`}
    >
      <div className="min-w-0 overflow-hidden p-0.5">
        <Controller
          control={control}
          name={`options.${optionIndex}.values.${valueIndex}.color`}
          render={({ field, fieldState: { error } }) => {
            const picked = COLOR_HEX_REGEX.test(field.value);
            return (
              <label
                title={picked ? field.value.toLowerCase() : undefined}
                className={`relative grid size-9 cursor-pointer place-items-center rounded-full transition-[background-color,box-shadow] duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-magenta has-[:disabled]:cursor-not-allowed motion-reduce:transition-none ${
                  picked
                    ? 'ring-1 ring-charcoal/15'
                    : `border-2 border-dashed text-charcoal/40 ${error ? 'border-red-400' : 'border-charcoal/20'}`
                }`}
                style={picked ? { backgroundColor: field.value } : undefined}
              >
                {!picked && <HiOutlineSwatch aria-hidden className="size-4" />}
                <input
                  ref={field.ref}
                  type="color"
                  name={field.name}
                  disabled={disabled}
                  // The native input cannot hold "nothing": it shows black until a colour is picked,
                  // but the FORM keeps `''` (required) until the admin actually chooses one.
                  value={picked ? field.value.toLowerCase() : '#000000'}
                  onChange={(event) => field.onChange(event.target.value)}
                  onBlur={field.onBlur}
                  aria-label={t(`${KEY}.pickColor`, { name: valueName })}
                  aria-invalid={Boolean(error) || undefined}
                  className="absolute inset-0 size-full cursor-pointer rounded-full opacity-0 disabled:cursor-not-allowed"
                />
              </label>
            );
          }}
        />
      </div>
    </div>
  );
};

/**
 * HOW the variations hold stock (owner 2026-10-30) — a two-card radio group: PER VARIATION (each is
 * a different item with its own quantity: candles by colour) or SHARED (each is a configuration of
 * the same unit: the arrangement with or without its add-on — one quantity on the product).
 */
const StockModeToggle: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const { t } = useTranslation();
  const { control, trigger, formState } = useFormContext<CreateProductFormType>();
  return (
    <Controller
      control={control}
      name="sharedStock"
      render={({ field }) => (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-charcoal">{t(`${KEY}.stockMode.title`)}</legend>
          <div className="grid gap-2 @min-[34rem]:grid-cols-2">
            {([false, true] as const).map((shared) => {
              const leaf = shared ? 'shared' : 'perVariant';
              const checked = field.value === shared;
              return (
                <label
                  key={leaf}
                  className={`flex min-w-0 cursor-pointer gap-2.5 rounded-control border p-3 transition-[border-color,background-color,box-shadow] duration-200 ease-[var(--ease-settle)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-magenta has-[:disabled]:cursor-not-allowed motion-reduce:transition-none ${
                    checked ? 'border-charcoal/40 bg-charcoal/[0.035]' : 'border-charcoal/[0.1] hover:border-charcoal/25'
                  }`}
                >
                  <input
                    type="radio"
                    name="product-stock-mode"
                    className="mt-0.5 size-4 shrink-0 cursor-pointer accent-charcoal disabled:cursor-not-allowed"
                    checked={checked}
                    disabled={disabled}
                    // Named by its title, described by its hint — the two spans would otherwise
                    // read as one run-on name.
                    aria-labelledby={`product-stock-mode-${leaf}`}
                    aria-describedby={`product-stock-mode-${leaf}-hint`}
                    onChange={() => {
                      field.onChange(shared);
                      // The quantity rule moves with the mode (product ↔ rows): once the form has
                      // spoken, re-check both sides so a stale message never lingers on either.
                      if (formState.isSubmitted) void trigger(['quantity', 'variants']);
                    }}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span id={`product-stock-mode-${leaf}`} className="text-sm font-medium text-charcoal">
                      {t(`${KEY}.stockMode.${leaf}`)}
                    </span>
                    <span id={`product-stock-mode-${leaf}-hint`} className="text-xs text-charcoal/55">
                      {t(`${KEY}.stockMode.${leaf}Hint`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    />
  );
};

/**
 * One option VALUE's photo set — its own `useGalleryImages` (capped at
 * `PRODUCT_OPTION_VALUE_IMAGE_MAX_COUNT`), registered under the value KEY so the form's submit can
 * upload every set in one presign call and place each set on its value. Always mounted while the
 * value exists (the photos survive collapsing the panel); unregistered when the value leaves.
 */
const ValueGallery: React.FC<{
  valueKey: string;
  initialImages: ProductImage[] | undefined;
  registry: React.RefObject<Map<string, GalleryState>>;
  onCount: (key: string, count: number) => void;
  disabled: boolean;
  progress: Record<string, number>;
  isUploading: boolean;
}> = ({ valueKey, initialImages, registry, onCount, disabled, progress, isUploading }) => {
  const gallery = useGalleryImages(initialImages, { maxCount: PRODUCT_OPTION_VALUE_IMAGE_MAX_COUNT });
  useEffect(() => {
    const map = registry.current;
    map.set(valueKey, gallery);
    return () => {
      map.delete(valueKey);
    };
  }, [registry, valueKey, gallery]);
  const count = gallery.images.length;
  useEffect(() => {
    onCount(valueKey, count);
  }, [onCount, valueKey, count]);
  return (
    <div className="@container">
      <ProductImageGallery
        gallery={gallery}
        compact
        errorId={`product-value-gallery-error-${valueKey}`}
        disabled={disabled}
        progress={progress}
        isUploading={isUploading}
      />
    </div>
  );
};

interface ProductVariationsEditorProps {
  disabled: boolean;
  /** Edit: the saved product — each variation's `usage` and each value's saved photos. */
  product?: Product;
  /** Filled by each value's gallery (value key → its live state); read by the form's submit. */
  galleries: React.RefObject<Map<string, GalleryState>>;
  /** Photos in the SHOWCASE right now — they count toward the product's total cap. */
  showcaseCount: number;
  progress: Record<string, number>;
  isUploading: boolean;
}

/**
 * The VARIATIONS section of the product form (a page, never a modal — FRONTEND-DOCTRINE §5).
 *
 * - **Options and values** ("Color: Rojo, Azul") are edited in place, reordered with arrow buttons
 *   (an option's order is the label order AND the photo precedence), and each value carries its own
 *   compact photo set.
 * - **Combinations**: every combination of the current values is listed; the admin OFFERS the ones
 *   that exist (a checkbox), and an offered one is a variation with its own stock and optional
 *   overrides whose placeholders show what it inherits from the product. Adding a value offers the
 *   combinations it creates; an option's first value completes every existing variation.
 * - **Removal copy is the SERVER's**: a saved variation's `usage` decides — `holding` > 0 cannot be
 *   removed (its checkbox, and any value/option removal that would drop it, is disabled with the
 *   reason); `lines` > 0 says it will be retired and history keeps it; none says it will be deleted.
 *
 * Structural moves write `options` and `variants` together through `setValue`, so the two can never
 * disagree; the inputs themselves are ordinary registered fields of the form.
 *
 * **Motion** (`useListMotion`): options, values, combination rows and a row's fields enter, leave and
 * reorder as list items. A removal plays first and COMMITS after (reading the form's latest state),
 * so what sits below glides up; focus left inside it moves to the neighbour's remove button, else to
 * the list's add button. Rows keep their identity across a change that renames their combination
 * (`carryRowKeys`), so an option's first value or a merge moves rows instead of rebuilding the table.
 */
const ProductVariationsEditor: React.FC<ProductVariationsEditorProps> = ({
  disabled,
  product,
  galleries,
  showcaseCount,
  progress,
  isUploading,
}) => {
  const { t } = useTranslation();
  const { control, setValue, getValues, formState } = useFormContext<CreateProductFormType>();
  /* v8 ignore next -- `?? []`: RHF always yields the arrays this form registers */
  const options = useWatch({ control, name: 'options' }) ?? [];
  /* v8 ignore next -- same */
  const variants = useWatch({ control, name: 'variants' }) ?? [];
  const businessTypeId = useWatch({ control, name: 'businessTypeId' });
  const productRent = useWatch({ control, name: 'rentPrice' });
  const productSell = useWatch({ control, name: 'sellPrice' });
  const productReplacement = useWatch({ control, name: 'replacementPrice' });
  const productDeposit = useWatch({ control, name: 'securityDeposit' });
  const sharedStock = useWatch({ control, name: 'sharedStock' });
  const isRent = businessTypeId === BUSINESS_TYPE_RENT;
  const errors = formState.errors;
  const motion = useListMotion();

  // What the SERVER said about each saved variation, and each saved value's photos — read once.
  const usageById = useMemo(
    () =>
      new Map<number, ProductVariantUsage | undefined>(
        (product?.variants ?? []).map((variant) => [variant.id, variant.usage]),
      ),
    [product],
  );
  const savedImagesByKey = useMemo(
    () =>
      new Map<string, ProductImage[]>(
        (product?.options ?? []).flatMap((option) =>
          option.values.map((value) => [valueKeyForId(value.id), value.images] as const),
        ),
      ),
    [product],
  );
  // A saved variation un-offered and offered again comes BACK (same id, stock, overrides) instead of
  // being deleted and recreated.
  const [parked, setParked] = useState<Map<string, VariantFormRow>>(() => new Map());
  // Each option's on-screen identity (index-aligned with `options`), and each combination row's.
  const [optionUids, setOptionUids] = useState<string[]>(() => options.map(() => mintOptionUid()));
  const [rowKeys, setRowKeys] = useState<Map<string, string>>(() => new Map());
  /* v8 ignore next -- defensive: every door that adds an option mints its uid in the same render */
  const uids = options.map((_, index) => optionUids[index] ?? `idx-${index}`);

  // A removal commits a beat after the click: it reads the identities as they are THEN.
  const latest = useRef({ uids, rowKeys });
  useLayoutEffect(() => {
    latest.current = { uids, rowKeys };
  });
  const addOptionButton = useRef<HTMLButtonElement>(null);
  const addValueButtons = useRef(new Map<string, HTMLButtonElement>());

  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const onCount = useCallback(
    (key: string, count: number) => setPhotoCounts((current) => ({ ...current, [key]: count })),
    [],
  );
  const [openPhotos, setOpenPhotos] = useState<Set<string>>(() => new Set());

  const write = (nextOptions: OptionFormRow[], nextVariants: VariantFormRow[]): void => {
    const opts = { shouldDirty: true, shouldValidate: formState.isSubmitted };
    setValue('options', nextOptions, opts);
    setValue('variants', nextVariants, opts);
  };
  /** Write a structural change, carrying each surviving row's identity through `project`. */
  const commit = (
    nextOptions: OptionFormRow[],
    nextVariants: VariantFormRow[],
    project: Projection | null,
    nextUids?: string[],
  ): void => {
    if (project) {
      setRowKeys(carryRowKeys(combinationsOf(getValues('options')), latest.current.rowKeys, project).rowKeys);
    }
    if (nextUids) setOptionUids(nextUids);
    write(nextOptions, nextVariants);
  };

  const holdingOf = (row: VariantFormRow): number =>
    row.id === undefined ? 0 : (usageById.get(row.id)?.holding ?? 0);
  /** Would dropping these rows touch a variation that still holds stock on an open order? */
  const blocks = (dropped: VariantFormRow[]): boolean => dropped.some((row) => holdingOf(row) > 0);
  /** The SAVED variations a structural move would drop (only saved ones can hold stock). */
  const droppedBy = (next: VariantFormRow[]): VariantFormRow[] => {
    const kept = new Set(next.map((row) => row.id));
    return variants.filter((row) => row.id !== undefined && !kept.has(row.id));
  };

  const combinations = combinationsOf(options);
  const indexByCombination = new Map(
    variants.map((row, index) => [combinationOf(row.valueKeys), index] as const),
  );
  /** The motion ids of what a structural change takes away: rows that vanish or merge away, and the
   *  fields of rows that stay listed but lose their variation. */
  const exitsOf = (nextVariants: VariantFormRow[], project: Projection): string[] => {
    const carried = carryRowKeys(combinations, rowKeys, project);
    const offeredAfter = new Set(nextVariants.map((row) => combinationOf(row.valueKeys)));
    const offeredBefore = new Set(
      combinations
        .filter((combo) => indexByCombination.has(combinationOf(combo)))
        .map((combo) => rowKeyOf(rowKeys, combo)),
    );
    const ids = carried.leaving.map((key) => `row:${key}`);
    for (const [target, key] of carried.rowKeys) {
      if (offeredBefore.has(key) && !offeredAfter.has(target)) ids.push(`fields:${key}`);
    }
    /* v8 ignore next -- past the cap means hundreds of listed rows: too slow to render in jsdom */
    return ids.length > ROW_MOTION_CAP ? [] : ids;
  };
  /** The rows a reorder glides (they follow the options' order) — none past the cap. */
  const rowIds = (): string[] => {
    const ids = combinations.map((combo) => `row:${rowKeyOf(rowKeys, combo)}`);
    /* v8 ignore next -- same cap */
    return ids.length > ROW_MOTION_CAP ? [] : ids;
  };

  // ── Options ──────────────────────────────────────────────────────────────────────────────────
  const addOption = (): void => {
    const uid = mintOptionUid();
    motion.reveal(`opt:${uid}`);
    setOptionUids([...uids, uid]);
    write([...options, { name: '', kind: 'generic', values: [] }], variants);
  };
  const removeOption = (index: number): void => {
    const uid = uids[index];
    const keys = new Set(options[index].values.map((value) => value.key));
    const project: Projection = (combo) => combo.filter((key) => !keys.has(key));
    // The last option takes the whole combinations section with it.
    const exits =
      options.length === 1 ? ['combos'] : exitsOf(dropOptionFromVariants(variants, [...keys]), project);
    motion.leave(
      [`opt:${uid}`, ...exits],
      () => {
        const at = latest.current.uids.indexOf(uid);
        /* v8 ignore next -- defensive: the option left by another path while this one played out */
        if (at === -1) return;
        const current = getValues('options');
        const gone = new Set(current[at].values.map((value) => value.key));
        commit(
          current.filter((_, i) => i !== at),
          dropOptionFromVariants(getValues('variants'), [...gone]),
          (combo) => combo.filter((key) => !gone.has(key)),
          latest.current.uids.filter((_, i) => i !== at),
        );
      },
      { focusFallback: () => addOptionButton.current },
    );
  };
  const moveOption = (index: number, to: number): void =>
    motion.reorder([...uids.map((uid) => `opt:${uid}`), ...rowIds()], () => {
      const next = [...options];
      const [moved] = next.splice(index, 1);
      next.splice(to, 0, moved);
      const nextUids = [...uids];
      const [movedUid] = nextUids.splice(index, 1);
      nextUids.splice(to, 0, movedUid);
      setOptionUids(nextUids);
      write(next, variants);
    });

  // ── Values ───────────────────────────────────────────────────────────────────────────────────
  const addValue = (optionIndex: number): void => {
    const key = mintValueKey(allValueKeys(options));
    const first = options[optionIndex].values.length === 0;
    const next = options.map((option, i) =>
      i === optionIndex ? { ...option, values: [...option.values, { key, name: '', color: '' }] } : option,
    );
    motion.reveal(`val:${key}`);
    // An option's FIRST value extends every listed combination — the same rows, one more value.
    commit(next, addValueCombinations(next, variants, optionIndex, key), first ? (combo) => [...combo, key] : null);
  };
  const removeValue = (optionIndex: number, valueKey: string): void => {
    const uid = uids[optionIndex];
    const project = valueRemoval(valueKey, options[optionIndex].values.length === 1);
    motion.leave(
      [`val:${valueKey}`, ...exitsOf(dropValueFromVariants(variants, valueKey), project)],
      () => {
        const current = getValues('options');
        const at = current.findIndex((option) => option.values.some((value) => value.key === valueKey));
        /* v8 ignore next -- defensive: the value left by another path while this one played out */
        if (at === -1) return;
        commit(
          current.map((option, i) =>
            i === at ? { ...option, values: option.values.filter((value) => value.key !== valueKey) } : option,
          ),
          dropValueFromVariants(getValues('variants'), valueKey),
          valueRemoval(valueKey, current[at].values.length === 1),
        );
      },
      { focusFallback: () => addValueButtons.current.get(uid) },
    );
  };
  const moveValue = (optionIndex: number, from: number, to: number): void =>
    motion.reorder(
      [...options[optionIndex].values.map((value) => `val:${value.key}`), ...rowIds()],
      () => {
        const next = options.map((option, i) => {
          if (i !== optionIndex) return option;
          const values = [...option.values];
          const [moved] = values.splice(from, 1);
          values.splice(to, 0, moved);
          return { ...option, values };
        });
        write(next, variants);
      },
    );
  const togglePhotos = (key: string): void =>
    setOpenPhotos((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── Combinations ────────────────────────────────────────────────────────────────────────────
  const offer = (combo: string[]): void => {
    /* v8 ignore next -- defensive: an unoffered checkbox is disabled at the cap */
    if (variants.length >= PRODUCT_MAX_VARIANTS) return;
    const restored = parked.get(combinationOf(combo));
    write(options, [...variants, restored ?? emptyVariantRow(combo)]);
  };
  /** Un-offer a combination: its fields leave first, then the variation does. */
  const withdraw = (rowKey: string, combination: string): void =>
    motion.leave([`fields:${rowKey}`], () => {
      const current = getValues('variants');
      const index = current.findIndex((row) => combinationOf(row.valueKeys) === combination);
      /* v8 ignore next -- defensive: withdrawn by another path while its fields left */
      if (index === -1) return;
      const row = current[index];
      if (row.id !== undefined) {
        const parkedRow = { ...row, isDefault: false };
        setParked((map) => new Map(map).set(combination, parkedRow));
      }
      write(
        getValues('options'),
        current.filter((_, i) => i !== index),
      );
    });
  const offerAll = (): void => {
    const next = [...variants];
    for (const combo of combinations) {
      if (next.length >= PRODUCT_MAX_VARIANTS) break;
      const combination = combinationOf(combo);
      if (indexByCombination.has(combination)) continue;
      next.push(parked.get(combination) ?? emptyVariantRow(combo));
    }
    write(options, next);
  };
  const makeDefault = (index: number): void =>
    setValue(
      'variants',
      getValues('variants').map((row, i) => ({ ...row, isDefault: i === index })),
      { shouldDirty: true },
    );

  const inherit = (value: string | undefined): string =>
    value && value.trim() !== '' ? t(`${KEY}.inherit`, { value }) : t(`${KEY}.inheritNone`);
  /** The PRICE must come from somewhere: with no general price to inherit, the row's is required. */
  const inheritPrice = (value: string | undefined): string =>
    value && value.trim() !== '' ? t(`${KEY}.inherit`, { value }) : t(`${KEY}.priceNeeded`);
  const colorTaken = options.some((option) => option.kind === 'color');

  // Saved variations that left the form and carry order history: retired on save (the server's
  // `usage`, never a guess). Holding ones cannot leave — every door that would drop them is disabled.
  const keptIds = new Set(variants.map((row) => row.id));
  const pendingRetire = (product?.variants ?? []).filter(
    (variant) => !keptIds.has(variant.id) && (variant.usage?.lines ?? 0) > 0,
  ).length;

  const valueKeys = allValueKeys(options);
  const photoTotal =
    showcaseCount +
    valueKeys.reduce(
      (sum, key) => sum + (photoCounts[key] ?? savedImagesByKey.get(key)?.length ?? 0),
      0,
    );

  return (
    <div className="@container flex flex-col gap-5">
      <Collapse open={options.length === 0} closedClassName="-mt-5">
        {options.length === 0 && <p className="text-sm text-charcoal/55">{t(`${KEY}.empty`)}</p>}
      </Collapse>

      {options.map((option, optionIndex) => {
        const uid = uids[optionIndex];
        const optionName = option.name.trim() || t(`${KEY}.unnamedValue`);
        const optionKeys = option.values.map((value) => value.key);
        const optionBlocked = blocks(droppedBy(dropOptionFromVariants(variants, optionKeys)));
        const isColor = option.kind === 'color';
        return (
          <fieldset
            // Keyed by the option's IDENTITY, so a move carries its node (and its motion) along; the
            // inputs inside are Controllers addressed by index PATH, which re-read the form's value
            // at their new path on the same render.
            key={uid}
            ref={motion.item(`opt:${uid}`)}
            className="flex min-w-0 flex-col gap-4 rounded-control border border-charcoal/[0.08] p-3 @min-[30rem]:p-4"
          >
            <legend className="sr-only">{optionName}</legend>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 grow basis-48">
                <CustomInputForm<CreateProductFormType>
                  id={`product-option-name-${optionIndex}`}
                  name={`options.${optionIndex}.name`}
                  type="text"
                  label={t(`${KEY}.optionLabel`)}
                  placeholder={t(`${KEY}.optionPlaceholder`)}
                  aria-label={t(`${KEY}.optionLabel`)}
                />
              </div>
              <div className="min-w-0 grow basis-32 @min-[30rem]:max-w-44">
                <OptionKindSelect
                  optionIndex={optionIndex}
                  colorAllowed={!colorTaken}
                  disabled={disabled}
                />
                <AnimatedMessage
                  id={`product-option-kind-error-${optionIndex}`}
                  errorMessage={messageOf(errors.options?.[optionIndex]?.kind)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-1 pt-1.5">
                <button
                  type="button"
                  className={ICON_BUTTON}
                  disabled={disabled || optionIndex === 0}
                  onClick={() => moveOption(optionIndex, optionIndex - 1)}
                  aria-label={t(`${KEY}.actions.moveOptionUp`, { name: optionName })}
                >
                  <HiOutlineChevronUp aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  className={ICON_BUTTON}
                  disabled={disabled || optionIndex === options.length - 1}
                  onClick={() => moveOption(optionIndex, optionIndex + 1)}
                  aria-label={t(`${KEY}.actions.moveOptionDown`, { name: optionName })}
                >
                  <HiOutlineChevronDown aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  data-focus-on-remove
                  className={DANGER_BUTTON}
                  disabled={disabled || optionBlocked}
                  title={optionBlocked ? t(`${KEY}.blockedRemoval`) : undefined}
                  onClick={() => removeOption(optionIndex)}
                  aria-label={t(`${KEY}.actions.removeOption`, { name: optionName })}
                >
                  <HiOutlineTrash aria-hidden className="size-4.5" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal/45">
                {t(`${KEY}.valuesTitle`)}
              </p>
              {option.values.map((value, valueIndex) => {
                const valueName = value.name.trim() || t(`${KEY}.unnamedValue`);
                const valueBlocked = blocks(droppedBy(dropValueFromVariants(variants, value.key)));
                const photosOpen = openPhotos.has(value.key);
                const photoCount =
                  photoCounts[value.key] ?? savedImagesByKey.get(value.key)?.length ?? 0;
                return (
                  <div
                    key={value.key}
                    ref={motion.item(`val:${value.key}`)}
                    className="flex min-w-0 flex-col gap-2"
                  >
                    <div className="flex flex-wrap items-start gap-2">
                      {/* The swatch and the name travel as one unit (a wrap never splits them). */}
                      <div className="flex min-w-0 grow basis-40 items-start gap-2">
                        <ValueColorSlot
                          optionIndex={optionIndex}
                          valueIndex={valueIndex}
                          open={isColor}
                          valueName={valueName}
                          disabled={disabled}
                        />
                        <div className="min-w-0 grow">
                          <CustomInputForm<CreateProductFormType>
                            id={`product-option-${optionIndex}-value-${valueIndex}`}
                            name={`options.${optionIndex}.values.${valueIndex}.name`}
                            type="text"
                            label={t(`${KEY}.valueLabel`)}
                            placeholder={t(isColor ? `${KEY}.colorValuePlaceholder` : `${KEY}.valuePlaceholder`)}
                            aria-label={t(`${KEY}.valueLabel`)}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 pt-1.5">
                        <button
                          type="button"
                          className={`${ICON_BUTTON} w-auto gap-1 px-2 text-xs font-medium`}
                          aria-expanded={photosOpen}
                          onClick={() => togglePhotos(value.key)}
                          aria-label={t(`${KEY}.photosToggle`, { name: valueName, count: photoCount })}
                        >
                          <HiOutlinePhoto aria-hidden className="size-4" />
                          <span aria-hidden className="tabular-nums">{photoCount}</span>
                        </button>
                        <button
                          type="button"
                          className={ICON_BUTTON}
                          disabled={disabled || valueIndex === 0}
                          onClick={() => moveValue(optionIndex, valueIndex, valueIndex - 1)}
                          aria-label={t(`${KEY}.actions.moveValueEarlier`, { name: valueName })}
                        >
                          <HiOutlineChevronLeft aria-hidden className="size-4" />
                        </button>
                        <button
                          type="button"
                          className={ICON_BUTTON}
                          disabled={disabled || valueIndex === option.values.length - 1}
                          onClick={() => moveValue(optionIndex, valueIndex, valueIndex + 1)}
                          aria-label={t(`${KEY}.actions.moveValueLater`, { name: valueName })}
                        >
                          <HiOutlineChevronRight aria-hidden className="size-4" />
                        </button>
                        <button
                          type="button"
                          data-focus-on-remove
                          className={DANGER_BUTTON}
                          disabled={disabled || valueBlocked}
                          title={valueBlocked ? t(`${KEY}.blockedRemoval`) : undefined}
                          onClick={() => removeValue(optionIndex, value.key)}
                          aria-label={t(`${KEY}.actions.removeValue`, { name: valueName })}
                        >
                          <HiOutlineTrash aria-hidden className="size-4.5" />
                        </button>
                      </div>
                    </div>
                    <AnimatedMessage
                      id={`product-option-${optionIndex}-value-${valueIndex}-color-error`}
                      errorMessage={
                        isColor ? messageOf(errors.options?.[optionIndex]?.values?.[valueIndex]?.color) : undefined
                      }
                    />
                    {/* Always mounted — collapsing must not lose the staged photos — and inert
                        while closed. */}
                    <Collapse open={photosOpen} closedClassName="-mt-2">
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-charcoal/50">
                          {t(`${KEY}.photosHint`, { max: PRODUCT_OPTION_VALUE_IMAGE_MAX_COUNT })}
                        </p>
                        <ValueGallery
                          valueKey={value.key}
                          initialImages={savedImagesByKey.get(value.key)}
                          registry={galleries}
                          onCount={onCount}
                          disabled={disabled}
                          progress={progress}
                          isUploading={isUploading}
                        />
                      </div>
                    </Collapse>
                  </div>
                );
              })}
              <AnimatedMessage
                id={`product-option-values-error-${optionIndex}`}
                errorMessage={messageOf(errors.options?.[optionIndex]?.values)}
              />
              <div className="self-start">
                <Button
                  ref={(element) => {
                    if (element) addValueButtons.current.set(uid, element);
                    else addValueButtons.current.delete(uid);
                  }}
                  variant="soft"
                  color={SECONDARY_COLOR}
                  size="sm"
                  disabled={disabled || option.values.length >= PRODUCT_MAX_OPTION_VALUES}
                  startIcon={<HiOutlinePlus className="size-4" />}
                  onClick={() => addValue(optionIndex)}
                >
                  {t(`${KEY}.actions.addValue`)}
                </Button>
              </div>
            </div>
          </fieldset>
        );
      })}

      <AnimatedMessage id="product-options-error" errorMessage={messageOf(errors.options)} />
      <div className="self-start">
        <Button
          ref={addOptionButton}
          variant="soft"
          color={SECONDARY_COLOR}
          size="sm"
          disabled={disabled || options.length >= PRODUCT_MAX_OPTIONS}
          startIcon={<HiOutlinePlus className="size-4" />}
          onClick={addOption}
        >
          {t(`${KEY}.actions.addOption`)}
        </Button>
      </div>

      {options.length > 0 && (
        <div ref={motion.item('combos')} className="flex flex-col gap-3 border-t border-charcoal/[0.07] pt-5">
          <div className="mb-2">
            <StockModeToggle disabled={disabled} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 grow basis-56">
              <h4 className="text-sm font-semibold text-charcoal">{t(`${KEY}.combinationsTitle`)}</h4>
              <p className="text-xs text-charcoal/50">
                {combinations.length === 0
                  ? t(`${KEY}.noCombinations`)
                  : t(`${KEY}.combinationsHint`, {
                      count: variants.length,
                      total: combinations.length,
                    })}
              </p>
            </div>
            <Button
              variant="soft"
              color={SECONDARY_COLOR}
              size="sm"
              disabled={
                disabled ||
                variants.length >= Math.min(combinations.length, PRODUCT_MAX_VARIANTS)
              }
              onClick={offerAll}
            >
              {t(`${KEY}.actions.offerAll`)}
            </Button>
          </div>

          <ul className="flex flex-col gap-3" role="list">
            {combinations.map((combo) => {
              const combination = combinationOf(combo);
              const rowKey = rowKeyOf(rowKeys, combo);
              const index = indexByCombination.get(combination);
              const label = variantLabelFor(options, combo) || t(`${KEY}.unnamedValue`);
              const row = index === undefined ? undefined : variants[index];
              const withdrawing = motion.leaving.has(`fields:${rowKey}`);
              const holding = row ? holdingOf(row) : 0;
              const parkedRow = parked.get(combination);
              const parkedUsage = parkedRow?.id === undefined ? undefined : usageById.get(parkedRow.id);
              const parkedNote = !row && parkedUsage !== undefined;
              return (
                <li
                  key={rowKey}
                  ref={motion.item(`row:${rowKey}`)}
                  className={`flex min-w-0 flex-col gap-3 rounded-control border p-3 transition-[border-color,background-color] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
                    row && !withdrawing
                      ? 'border-charcoal/[0.1] bg-white'
                      : 'border-dashed border-charcoal/[0.1] bg-charcoal/[0.015]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex min-w-0 grow basis-48 cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 cursor-pointer accent-charcoal disabled:cursor-not-allowed"
                        checked={row !== undefined && !withdrawing}
                        disabled={
                          disabled ||
                          withdrawing ||
                          holding > 0 ||
                          (row === undefined && variants.length >= PRODUCT_MAX_VARIANTS)
                        }
                        onChange={() => (index === undefined ? offer(combo) : withdraw(rowKey, combination))}
                        aria-label={t(`${KEY}.offer`, { label })}
                      />
                      <span className="min-w-0 truncate text-sm font-medium text-charcoal">{label}</span>
                    </label>
                    {/* The radio and the "not offered" note fade in as they take the slot (CSS
                        `@starting-style`); the default's highlight eases from row to row. */}
                    {row && index !== undefined ? (
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-chip px-2 py-1 text-xs transition-[color,background-color,opacity] duration-200 ease-[var(--ease-settle)] starting:opacity-0 motion-reduce:transition-none ${
                          row.isDefault ? 'bg-charcoal/[0.06] font-medium text-charcoal' : 'text-charcoal/65'
                        }`}
                      >
                        <input
                          type="radio"
                          name="product-default-variant"
                          className="size-4 cursor-pointer accent-charcoal"
                          checked={row.isDefault}
                          disabled={disabled}
                          onChange={() => makeDefault(index)}
                        />
                        {t(`${KEY}.defaultLabel`)}
                      </label>
                    ) : (
                      <span className="px-2 text-xs text-charcoal/40 transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none">
                        {t(`${KEY}.notOffered`)}
                      </span>
                    )}
                  </div>
                  {holding > 0 && (
                    <p className="text-xs text-amber-700">{t(`${KEY}.holding`, { count: holding })}</p>
                  )}
                  <Collapse open={parkedNote} closedClassName="-mt-3">
                    {parkedNote && (
                      <p className="text-xs text-charcoal/55">
                        {parkedUsage.lines > 0 ? t(`${KEY}.willRetire`) : t(`${KEY}.willDelete`)}
                      </p>
                    )}
                  </Collapse>
                  {row && index !== undefined && (
                    <div ref={motion.item(`fields:${rowKey}`)} className="flex min-w-0 flex-col gap-3">
                      <AnimatedMessage
                        id={`product-variant-keys-error-${index}`}
                        errorMessage={messageOf(errors.variants?.[index]?.valueKeys)}
                      />
                      <div className="grid gap-x-3 gap-y-field @min-[30rem]:grid-cols-2 @min-[52rem]:grid-cols-4">
                        {/* The cell stays in the grid either way (nothing beside it reflows); its
                            content swaps between the row's own stock and the shared-pool note. The
                            typed number survives the round trip — it is simply not sent. */}
                        <SlotSwap swapKey={sharedStock ? 'shared' : 'own'} className="min-w-0">
                          {sharedStock ? (
                            <p className="flex min-h-11 items-center text-xs text-charcoal/55">
                              {t(`${KEY}.stockMode.sharedCell`)}
                            </p>
                          ) : (
                            <CustomInputForm<CreateProductFormType>
                              id={`product-variant-quantity-${index}`}
                              name={`variants.${index}.quantity`}
                              {...integerInput}
                              label={t(`${KEY}.quantityLabel`)}
                              aria-label={`${t(`${KEY}.quantityLabel`)} · ${label}`}
                            />
                          )}
                        </SlotSwap>
                        {isRent ? (
                          <>
                            <div className="min-w-0">
                              <CustomInputForm<CreateProductFormType>
                                id={`product-variant-rent-${index}`}
                                name={`variants.${index}.rentPrice`}
                                {...decimalInput}
                                label={t(`${KEY}.rentPriceLabel`)}
                                placeholder={inheritPrice(productRent)}
                                aria-label={`${t(`${KEY}.rentPriceLabel`)} · ${label}`}
                              />
                            </div>
                            <div className="min-w-0">
                              <CustomInputForm<CreateProductFormType>
                                id={`product-variant-deposit-${index}`}
                                name={`variants.${index}.securityDeposit`}
                                {...decimalInput}
                                label={t(`${KEY}.securityDepositLabel`)}
                                placeholder={inherit(productDeposit)}
                                aria-label={`${t(`${KEY}.securityDepositLabel`)} · ${label}`}
                                instructions={t(`${KEY}.securityDepositZeroHint`)}
                                deps={[`variants.${index}.replacementPrice`]}
                              />
                            </div>
                            <div className="min-w-0">
                              <CustomInputForm<CreateProductFormType>
                                id={`product-variant-replacement-${index}`}
                                name={`variants.${index}.replacementPrice`}
                                {...decimalInput}
                                label={t(`${KEY}.replacementPriceLabel`)}
                                placeholder={inherit(productReplacement)}
                                aria-label={`${t(`${KEY}.replacementPriceLabel`)} · ${label}`}
                                deps={[`variants.${index}.securityDeposit`]}
                              />
                            </div>
                          </>
                        ) : (
                          <div className="min-w-0">
                            <CustomInputForm<CreateProductFormType>
                              id={`product-variant-sell-${index}`}
                              name={`variants.${index}.sellPrice`}
                              {...decimalInput}
                              label={t(`${KEY}.sellPriceLabel`)}
                              placeholder={inheritPrice(productSell)}
                              aria-label={`${t(`${KEY}.sellPriceLabel`)} · ${label}`}
                            />
                          </div>
                        )}
                        <div className="min-w-0 @min-[30rem]:col-span-2 @min-[52rem]:col-span-4">
                          <CustomInputForm<CreateProductFormType>
                            id={`product-variant-description-${index}`}
                            name={`variants.${index}.description`}
                            type="text"
                            label={t(`${KEY}.descriptionLabel`)}
                            placeholder={t(`${KEY}.inheritDescription`)}
                            aria-label={`${t(`${KEY}.descriptionLabel`)} · ${label}`}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <AnimatedMessage id="product-variants-error" errorMessage={messageOf(errors.variants)} />
        </div>
      )}

      <Collapse open={pendingRetire > 0} closedClassName="-mt-5">
        {pendingRetire > 0 && (
          <p className="rounded-control bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t(`${KEY}.pendingRetire`, { count: pendingRetire })}
          </p>
        )}
      </Collapse>
      <Collapse open={options.length > 0} closedClassName="-mt-5">
        {options.length > 0 && (
          <p
            className={`text-xs transition-colors duration-200 ${photoTotal > PRODUCT_IMAGE_MAX_TOTAL ? 'font-semibold text-red-600' : 'text-charcoal/45'}`}
          >
            {t(`${KEY}.photosTotal`, { count: photoTotal, max: PRODUCT_IMAGE_MAX_TOTAL })}
          </p>
        )}
      </Collapse>
    </div>
  );
};

export default ProductVariationsEditor;
