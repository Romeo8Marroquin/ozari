import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineChevronDown,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineChevronUp,
  HiOutlinePhoto,
  HiOutlinePlus,
  HiOutlineTrash,
} from 'react-icons/hi2';
import AnimatedMessage from '@components/AnimatedMessage';
import Button from '@components/Button';
import CustomInputForm from '@components/CustomInputForm';
import {
  PRODUCT_IMAGE_MAX_TOTAL,
  PRODUCT_MAX_OPTION_VALUES,
  PRODUCT_MAX_OPTIONS,
  PRODUCT_MAX_VARIANTS,
  PRODUCT_OPTION_VALUE_IMAGE_MAX_COUNT,
} from '@constants/Regex';
import { decimalInput, integerInput } from '@utils/numericInput';
import type { Product, ProductImage, ProductVariantUsage } from './product.types';
import ProductImageGallery from './ProductImageGallery';
import {
  addValueCombinations,
  allValueKeys,
  combinationOf,
  dropOptionFromVariants,
  dropValueFromVariants,
  emptyVariantRow,
  generateCombinations,
  mintValueKey,
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

/** An RHF error node's message, wherever the resolver put it (a leaf, or an array's `root`). */
const messageOf = (node: unknown): string | undefined => {
  const error = node as { message?: string; root?: { message?: string } } | undefined;
  return error?.message ?? error?.root?.message;
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
  const isRent = businessTypeId === BUSINESS_TYPE_RENT;
  const errors = formState.errors;

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

  const holdingOf = (row: VariantFormRow): number =>
    row.id === undefined ? 0 : (usageById.get(row.id)?.holding ?? 0);
  /** Would dropping these rows touch a variation that still holds stock on an open order? */
  const blocks = (dropped: VariantFormRow[]): boolean => dropped.some((row) => holdingOf(row) > 0);
  /** The SAVED variations a structural move would drop (only saved ones can hold stock). */
  const droppedBy = (next: VariantFormRow[]): VariantFormRow[] => {
    const kept = new Set(next.map((row) => row.id));
    return variants.filter((row) => row.id !== undefined && !kept.has(row.id));
  };

  // ── Options ──────────────────────────────────────────────────────────────────────────────────
  const addOption = (): void => write([...options, { name: '', values: [] }], variants);
  const removeOption = (index: number): void => {
    const keys = options[index].values.map((value) => value.key);
    write(
      options.filter((_, i) => i !== index),
      dropOptionFromVariants(variants, keys),
    );
  };
  const moveOption = (index: number, to: number): void => {
    const next = [...options];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    write(next, variants);
  };

  // ── Values ───────────────────────────────────────────────────────────────────────────────────
  const addValue = (optionIndex: number): void => {
    const key = mintValueKey(allValueKeys(options));
    const next = options.map((option, i) =>
      i === optionIndex ? { ...option, values: [...option.values, { key, name: '' }] } : option,
    );
    write(next, addValueCombinations(next, variants, optionIndex, key));
  };
  const removeValue = (optionIndex: number, valueKey: string): void => {
    const next = options.map((option, i) =>
      i === optionIndex
        ? { ...option, values: option.values.filter((value) => value.key !== valueKey) }
        : option,
    );
    write(next, dropValueFromVariants(variants, valueKey));
  };
  const moveValue = (optionIndex: number, from: number, to: number): void => {
    const next = options.map((option, i) => {
      if (i !== optionIndex) return option;
      const values = [...option.values];
      const [moved] = values.splice(from, 1);
      values.splice(to, 0, moved);
      return { ...option, values };
    });
    write(next, variants);
  };
  const togglePhotos = (key: string): void =>
    setOpenPhotos((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── Combinations ────────────────────────────────────────────────────────────────────────────
  const combinations = generateCombinations(options.filter((option) => option.values.length > 0));
  const indexByCombination = new Map(
    variants.map((row, index) => [combinationOf(row.valueKeys), index] as const),
  );
  const offer = (combo: string[]): void => {
    /* v8 ignore next -- defensive: an unoffered checkbox is disabled at the cap */
    if (variants.length >= PRODUCT_MAX_VARIANTS) return;
    const restored = parked.get(combinationOf(combo));
    write(options, [...variants, restored ?? emptyVariantRow(combo)]);
  };
  const withdraw = (index: number): void => {
    const row = variants[index];
    if (row.id !== undefined) {
      const parkedRow = { ...row, isDefault: false };
      setParked((current) => new Map(current).set(combinationOf(row.valueKeys), parkedRow));
    }
    write(
      options,
      variants.filter((_, i) => i !== index),
    );
  };
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
      {options.length === 0 && <p className="text-sm text-charcoal/55">{t(`${KEY}.empty`)}</p>}

      {options.map((option, optionIndex) => {
        const optionName = option.name.trim() || t(`${KEY}.unnamedValue`);
        const optionKeys = option.values.map((value) => value.key);
        const optionBlocked = blocks(droppedBy(dropOptionFromVariants(variants, optionKeys)));
        return (
          <fieldset
            // Index keys on purpose: every input inside is addressed by its index PATH, so a
            // re-render after a move must re-address the same slots rather than keep stale ones.
            key={optionIndex}
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
                  <div key={value.key} className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 grow basis-40">
                        <CustomInputForm<CreateProductFormType>
                          id={`product-option-${optionIndex}-value-${valueIndex}`}
                          name={`options.${optionIndex}.values.${valueIndex}.name`}
                          type="text"
                          label={t(`${KEY}.valueLabel`)}
                          placeholder={t(`${KEY}.valuePlaceholder`)}
                          aria-label={t(`${KEY}.valueLabel`)}
                        />
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
                    {/* Always mounted — collapsing must not lose the staged photos — and inert
                        while closed (the always-mounted grid-rows collapse). */}
                    <div
                      inert={!photosOpen}
                      aria-hidden={!photosOpen}
                      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
                        photosOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                      }`}
                    >
                      <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
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
                    </div>
                  </div>
                );
              })}
              <AnimatedMessage
                id={`product-option-values-error-${optionIndex}`}
                errorMessage={messageOf(errors.options?.[optionIndex]?.values)}
              />
              <div className="self-start">
                <Button
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
        <div className="flex flex-col gap-3 border-t border-charcoal/[0.07] pt-5">
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
              const index = indexByCombination.get(combination);
              const label = variantLabelFor(options, combo) || t(`${KEY}.unnamedValue`);
              const row = index === undefined ? undefined : variants[index];
              const holding = row ? holdingOf(row) : 0;
              const parkedRow = parked.get(combination);
              const parkedUsage = parkedRow?.id === undefined ? undefined : usageById.get(parkedRow.id);
              return (
                <li
                  key={combination}
                  className={`flex min-w-0 flex-col gap-3 rounded-control border p-3 ${
                    row ? 'border-charcoal/[0.1] bg-white' : 'border-dashed border-charcoal/[0.1] bg-charcoal/[0.015]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex min-w-0 grow basis-48 cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 cursor-pointer accent-charcoal disabled:cursor-not-allowed"
                        checked={row !== undefined}
                        disabled={
                          disabled ||
                          holding > 0 ||
                          (row === undefined && variants.length >= PRODUCT_MAX_VARIANTS)
                        }
                        onChange={() => (index === undefined ? offer(combo) : withdraw(index))}
                        aria-label={t(`${KEY}.offer`, { label })}
                      />
                      <span className="min-w-0 truncate text-sm font-medium text-charcoal">{label}</span>
                    </label>
                    {row && index !== undefined ? (
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-charcoal/65">
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
                      <span className="text-xs text-charcoal/40">{t(`${KEY}.notOffered`)}</span>
                    )}
                  </div>
                  {holding > 0 && (
                    <p className="text-xs text-amber-700">{t(`${KEY}.holding`, { count: holding })}</p>
                  )}
                  {!row && parkedUsage !== undefined && (
                    <p className="text-xs text-charcoal/55">
                      {parkedUsage.lines > 0 ? t(`${KEY}.willRetire`) : t(`${KEY}.willDelete`)}
                    </p>
                  )}
                  {row && index !== undefined && (
                    <>
                      <AnimatedMessage
                        id={`product-variant-keys-error-${index}`}
                        errorMessage={messageOf(errors.variants?.[index]?.valueKeys)}
                      />
                      <div className="grid gap-x-3 gap-y-field @min-[30rem]:grid-cols-2 @min-[52rem]:grid-cols-4">
                        <div className="min-w-0">
                          <CustomInputForm<CreateProductFormType>
                            id={`product-variant-quantity-${index}`}
                            name={`variants.${index}.quantity`}
                            {...integerInput}
                            label={t(`${KEY}.quantityLabel`)}
                            aria-label={`${t(`${KEY}.quantityLabel`)} · ${label}`}
                          />
                        </div>
                        {isRent ? (
                          <>
                            <div className="min-w-0">
                              <CustomInputForm<CreateProductFormType>
                                id={`product-variant-rent-${index}`}
                                name={`variants.${index}.rentPrice`}
                                {...decimalInput}
                                label={t(`${KEY}.rentPriceLabel`)}
                                placeholder={inherit(productRent)}
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
                              placeholder={inherit(productSell)}
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
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <AnimatedMessage id="product-variants-error" errorMessage={messageOf(errors.variants)} />
        </div>
      )}

      {pendingRetire > 0 && (
        <p className="rounded-control bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t(`${KEY}.pendingRetire`, { count: pendingRetire })}
        </p>
      )}
      {options.length > 0 && (
        <p
          className={`text-xs ${photoTotal > PRODUCT_IMAGE_MAX_TOTAL ? 'font-semibold text-red-600' : 'text-charcoal/45'}`}
        >
          {t(`${KEY}.photosTotal`, { count: photoTotal, max: PRODUCT_IMAGE_MAX_TOTAL })}
        </p>
      )}
    </div>
  );
};

export default ProductVariationsEditor;
