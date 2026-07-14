import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowPath, HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi2';
import Button from '@components/Button';
import CustomInputForm from '@components/CustomInputForm';
import CustomSelectForm from '@components/CustomSelectForm';
import CustomTextareaForm from '@components/CustomTextareaForm';
import FormError from '@components/FormError';
import { notify } from '@components/notifications/notify';
import { QueryKeys } from '@constants/QueryKeys';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { toFormError } from '@utils/apiError';
import {
  detailRowIn,
  detailRowOut,
  SECTION_REVEAL_STEP,
  staggerIn,
  staggerOut,
} from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import type { CatalogOption, CurrencyCatalogOption, ProductCatalog } from './product.types';
import {
  clearProductDraft,
  isMeaningfulDraft,
  readProductDraft,
  saveProductDraft,
} from './productDraft';
import ProductImageGallery from './ProductImageGallery';
import ProductsStatus from './ProductsStatus';
import SectionReveal from './SectionReveal';
import { useGalleryImages } from './useGalleryImages';
import { useProductImageUploads } from './useProductImageUploads';
import {
  BUSINESS_TYPE_RENT,
  createProductDefaultValues,
  createProductRequiredPatterns,
  createProductSchema,
  DEFAULT_RENT_TIME_UNIT_ID,
  toCreateProductBody,
  type CreateProductFormType,
} from './SchemaCreateProduct';
import { useCreateProduct } from './useCreateProduct';
import { useProductCatalog } from './useProductCatalog';

const FORM_ID = 'create-product-form';
const KEY = 'modules.panel.products.create';
const SECONDARY_COLOR = '#262626';
const SKELETON = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

/** A section card matching the settings surface language — each one is a `.reveal-block`. */
const FormSection: React.FC<{ title: string; description: string; children: React.ReactNode }> = ({
  title,
  description,
  children,
}) => (
  <section className="reveal-block min-w-0 rounded-card border border-charcoal/[0.07] bg-white px-5 py-5 shadow-sm sm:px-6">
    <h3 className="text-base font-semibold text-charcoal">{title}</h3>
    <p className="mb-5 mt-1 text-sm leading-relaxed text-charcoal/55">{description}</p>
    {children}
  </section>
);

const toOptions = (rows: CatalogOption[]) =>
  rows.map((row) => ({ value: row.id, label: row.name }));
const toCurrencyOptions = (rows: CurrencyCatalogOption[]) =>
  rows.map((row) => ({ value: row.id, label: `${row.name} (${row.symbol})` }));

// ── Skeleton BODIES, one per section (the card chrome — title/description — stays REAL while
// loading; only the catalog-dependent body shimmers). Shapes mirror the real fields so each card's
// reveal barely has to morph. Static JSX: no props, rendered by `SectionReveal` in both layers. ──
const INFO_SKELETON = (
  <div className="flex flex-col gap-5">
    <span aria-hidden className={`block h-11 w-full ${SKELETON}`} />
    <span aria-hidden className={`block h-24 w-full ${SKELETON}`} />
    <div className="grid gap-5 sm:grid-cols-2">
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
    </div>
    <span aria-hidden className={`block h-11 w-full ${SKELETON}`} />
  </div>
);
const PHOTOS_SKELETON = (
  <div className="flex flex-col gap-4">
    <span aria-hidden className={`block h-36 w-full rounded-control ${SKELETON}`} />
    <span aria-hidden className={`block h-3 w-24 self-end ${SKELETON}`} />
  </div>
);
const PRICING_SKELETON = (
  <div className="flex flex-col gap-5">
    <div className="grid gap-5 sm:grid-cols-2">
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
    </div>
    <div className="grid gap-5 sm:grid-cols-2">
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
      <span aria-hidden className={`block h-11 ${SKELETON}`} />
    </div>
  </div>
);
const DETAILS_SKELETON = (
  <span aria-hidden className={`block h-9 w-40 rounded-control ${SKELETON}`} />
);

/**
 * A catalog the form can actually work with: every REQUIRED lookup non-empty. A 200 with empty
 * lists (a wiped/unseeded DB) would otherwise render selects with nothing to choose — a form the
 * user can fill but never submit. Treated exactly like a failed fetch: the honest retry panel.
 */
const isCatalogUsable = (catalog: ProductCatalog | null | undefined): catalog is ProductCatalog =>
  Boolean(
    catalog &&
      catalog.businessTypes.length > 0 &&
      catalog.categories.length > 0 &&
      catalog.currencies.length > 0 &&
      catalog.rentTimeUnits.length > 0 &&
      catalog.detailTypes.length > 0,
  );

type FormView = 'form' | 'error';

/**
 * Decouples the TARGET view (form ↔ the catalog-error retry panel) from the RENDERED one so the
 * swap rides the page vocabulary instead of a hard React replace: the current view's
 * `.reveal-block`s sweep out (`staggerOut`), only then the other view commits, and it sweeps in
 * (`staggerIn`) — the same doctrine as `useModalPhaseTransition`, on page primitives. The initial
 * mount renders its target directly (the page entrance owns that motion); reduced motion swaps
 * instantly inside the pageMotion helpers.
 */
function useViewSwap(target: FormView, root: React.RefObject<HTMLDivElement | null>): FormView {
  const [rendered, setRendered] = useState(target);
  const isInitial = useRef(true);

  useEffect(() => {
    if (target === rendered) return;
    let cancelled = false;
    void staggerOut(root.current, '.reveal-block').then(() => {
      if (!cancelled) setRendered(target);
    });
    return () => {
      cancelled = true;
    };
  }, [target, rendered, root]);

  useLayoutEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    staggerIn(root.current, '.reveal-block');
  }, [rendered, root]);

  return rendered;
}

/**
 * One details row: registers its element (for the exit tween) and, when it was added by the user
 * mid-session (never on a draft-restore/reveal mount), grows in from the left like a list entry.
 */
const DetailRow: React.FC<{
  animateIn: boolean;
  onRegister: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}> = ({ animateIn, onRegister, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (animateIn) detailRowIn(ref.current);
  }, [animateIn]);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        onRegister(el);
      }}
      className="reveal-item flex items-start gap-3"
    >
      {children}
    </div>
  );
};

/**
 * The product create form. Owns its errors per the form doctrine (`skipErrorNotification` +
 * `toFormError`): backend validation lands in the form-level banner, ambient failures toast, an
 * outage goes silent (the overlay owns it). Work is protected by a SILENT sessionStorage draft —
 * autosaved on every change, restored on return with a visible note + explicit discard, cleared on
 * a successful create (and on logout via `clearAuthState`). No blocking "leave?" dialogs, ever.
 *
 * Loading is per-card: every section renders its REAL chrome from first paint with a shimmer body
 * (`SectionReveal`), and when the catalog lands the cards reveal in a cascade — each one morphing
 * to its content's height while its fields wave in (`.reveal-item`) — so "loading → loaded" is one
 * integrated transformation, never a swap.
 */
const ProductForm: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const queryClient = useQueryClient();
  const { data: catalog, isLoading, isError, isFetching, refetch } = useProductCatalog();
  const { createProduct, isPending } = useCreateProduct();
  const [formError, setFormError] = useState<string | undefined>(undefined);

  // Photos live OUTSIDE the RHF form: File objects can't join the sessionStorage draft, and the
  // gallery validates imperatively on add (see useGalleryImages). Uploaded only at submit time —
  // presigned PUTs straight to R2 — so an abandoned form never leaves orphaned objects behind.
  const gallery = useGalleryImages();
  const { uploadImages, isUploading, progress } = useProductImageUploads();
  const isBusy = isPending || isUploading;

  // Root of whichever view is on screen — the sweep target for the form ↔ error-panel swap.
  const viewRoot = useRef<HTMLDivElement>(null);

  // The draft is read ONCE per mount (never re-read mid-session — the form itself is the source of
  // truth once mounted); its presence drives the "restored" note until discarded.
  const [draft] = useState(readProductDraft);
  const [draftRestored, setDraftRestored] = useState(Boolean(draft));

  const methods = useForm<CreateProductFormType>({
    resolver: zodResolver(createProductSchema),
    defaultValues: draft ?? createProductDefaultValues,
    mode: 'onTouched',
  });
  const { handleSubmit, setValue, clearErrors, reset, control } = methods;
  const details = useFieldArray({ control, name: 'details' });

  // Detail rows animate OUT before RHF drops them (and IN when the user adds one) — so the list
  // grows/shrinks smoothly instead of snapping. Rows present at MOUNT (a restored draft) never
  // play the add entrance; a ref-mirror of the fields gives the exit handler the LIVE index to
  // remove once its tween finishes (indices may have shifted meanwhile).
  const [initialDetailIds] = useState(() => new Set(details.fields.map((row) => row.id)));
  const detailRowRefs = useRef(new Map<string, HTMLDivElement>());
  const latestDetailFields = useRef(details.fields);
  useEffect(() => {
    latestDetailFields.current = details.fields;
  }, [details.fields]);
  const removingDetailIds = useRef(new Set<string>());
  const removeDetail = (id: string): void => {
    if (removingDetailIds.current.has(id)) return; // the row is already on its way out
    removingDetailIds.current.add(id);
    /* v8 ignore next -- `?? null`: defensive; a rendered row always has its element registered */
    void detailRowOut(detailRowRefs.current.get(id) ?? null).then(() => {
      removingDetailIds.current.delete(id);
      const index = latestDetailFields.current.findIndex((row) => row.id === id);
      /* v8 ignore next -- defensive: the row can only vanish through this very handler */
      if (index !== -1) details.remove(index);
    });
  };

  // Silent autosave: every change persists the draft (tiny object, sessionStorage); a form back at
  // its pristine state clears it instead, so an untouched visit never leaves residue. `useWatch`
  // (not `watch()`) so the React Compiler can still memoize this component.
  const liveValues = useWatch({ control });
  useEffect(() => {
    const current = liveValues as CreateProductFormType;
    if (isMeaningfulDraft(current)) saveProductDraft(current);
    else clearProductDraft();
  }, [liveValues]);

  // A business-type SWITCH clears the now-irrelevant price fields (stale values must never submit)
  // and re-arms the rent defaults. Reacts only to real changes — never the initial mount, which may
  // be a restored draft whose fields must survive untouched.
  const businessTypeId = useWatch({ control, name: 'businessTypeId' });
  const isRent = businessTypeId === BUSINESS_TYPE_RENT;

  // ONE detail per type: each row's select hides the types other rows already picked (its own
  // selection stays listed), and "Agregar detalle" caps out at the number of available types —
  // so a duplicate is unreachable through the UI (the schema + backend still enforce it).
  const detailValues = useWatch({ control, name: 'details' });
  const usedDetailTypeIds = new Set(
    /* v8 ignore next 2 -- `?? []` + `?.`: defensive; RHF always yields the details array/rows */
    (detailValues ?? [])
      .map((row) => row?.detailTypeId)
      .filter((id): id is number => typeof id === 'number'),
  );
  const previousType = useRef(businessTypeId);
  useEffect(() => {
    if (previousType.current === businessTypeId) return;
    previousType.current = businessTypeId;
    if (businessTypeId === BUSINESS_TYPE_RENT) {
      setValue('sellPrice', '');
      setValue('rentTimeUnitId', DEFAULT_RENT_TIME_UNIT_ID);
      clearErrors(['sellPrice']);
    } else {
      // `null`, never `undefined` — RHF ignores undefined in setValue/reset (falls back to defaults).
      setValue('rentTimeUnitId', null as unknown as number);
      setValue('rentPrice', '');
      clearErrors(['rentPrice', 'rentTimeUnitId']);
    }
  }, [businessTypeId, setValue, clearErrors]);

  const discardDraft = (): void => {
    // Move focus off the note's button BEFORE its container turns aria-hidden/inert — Chrome
    // refuses (and warns about) aria-hidden on an ancestor of the focused element.
    /* v8 ignore next -- activeElement is always the clicked button here; blur() is a no-op guard */
    (document.activeElement as HTMLElement | null)?.blur?.();
    clearProductDraft();
    reset(createProductDefaultValues);
    setDraftRestored(false);
  };

  const submitWithImages = async (data: CreateProductFormType): Promise<void> => {
    setFormError(undefined);

    // Phase 1 — upload the staged photos (presign + direct-to-R2 PUTs). A failure here keeps the
    // staged files intact, surfaces per the form doctrine, and never reaches the create call — so
    // the user just fixes/retries the same submit.
    let imageKeys: string[];
    try {
      imageKeys = await uploadImages(gallery.images);
    } catch (error) {
      const { inline, toast } = toFormError(error, t(`${KEY}.gallery.errors.uploadFailed`));
      if (inline) setFormError(inline);
      if (toast) notify.error(toast);
      return;
    }

    // Phase 2 — create the product referencing the uploaded keys (order = display order; the
    // starred photo carries the primary flag).
    createProduct(
      {
        ...toCreateProductBody(data),
        ...(imageKeys.length > 0 && {
          images: imageKeys.map((key, index) => ({
            key,
            isPrimary: gallery.images[index].id === gallery.primaryId,
          })),
        }),
      },
      {
        onSuccess: () => {
          clearProductDraft();
          void queryClient.invalidateQueries({ queryKey: [QueryKeys.PRODUCTS] });
          notify.success(t(`${KEY}.successToast`), { title: t(`${KEY}.successTitle`) });
          panelNavigate('/panel/productos');
        },
        onError: (error) => {
          const { inline, toast } = toFormError(error, t(`${KEY}.errors.submitFallback`));
          if (inline) setFormError(inline);
          if (toast) notify.error(toast);
        },
      },
    );
  };

  const onSubmit = (data: CreateProductFormType): void => {
    if (isBusy) return;
    void submitWithImages(data);
  };

  const requiredPatternsValue = useMemo(
    () => ({ requiredPatterns: createProductRequiredPatterns }),
    [],
  );

  // The two whole-form views. ANY catalog failure shape targets the honest retry panel — a
  // 4xx/5xx (isError), a null payload, or a "successful" response with empty lookup lists — and
  // the swap between them SWEEPS via useViewSwap (never a hard replace). While a swap-to-error is
  // in flight the form still shows its skeleton bodies (`!catalogReady`), so nothing empty flashes.
  const catalogReady = isCatalogUsable(catalog);
  const targetView: FormView = isError || (!isLoading && !catalogReady) ? 'error' : 'form';
  const renderedView = useViewSwap(targetView, viewRoot);

  if (renderedView === 'error') {
    return (
      <div ref={viewRoot} className="flex w-full flex-1 flex-col">
        <div className="reveal-block flex flex-1 flex-col">
          <ProductsStatus
            tone="error"
            title={t(`${KEY}.catalogError.title`)}
            description={t(`${KEY}.catalogError.description`)}
            action={
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                size="sm"
                loading={isFetching}
                startIcon={<HiOutlineArrowPath className="size-4" />}
                onClick={() => void refetch()}
              >
                {t(`${KEY}.catalogError.retry`)}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={viewRoot} className="flex w-full flex-1 flex-col">
    <RequiredPatternsContext.Provider value={requiredPatternsValue}>
      <FormProvider {...methods}>
        <form
          id={FORM_ID}
          onSubmit={handleSubmit(onSubmit)}
          aria-busy={isLoading}
          className="flex flex-col gap-6"
        >
          {isLoading && (
            <span role="status" aria-label={t(`${KEY}.loading`)} className="sr-only" />
          )}

          {/* Restored-draft note: visible, dismissible, never blocking. Always mounted in a
              grid-rows 0fr↔1fr collapse (the FormError trick) so appearing/discarding EASES the
              space open/closed instead of shoving the sections; `-mb-6` cancels the column gap
              while collapsed and transitions back in step with the height. */}
          <div
            aria-hidden={!draftRestored}
            inert={!draftRestored}
            className={`grid transition-[grid-template-rows,margin] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
              draftRestored ? 'grid-rows-[1fr]' : '-mb-6 grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden">
              <div className="reveal-block flex flex-wrap items-center justify-between gap-2 rounded-control border border-charcoal/[0.08] bg-charcoal/[0.03] px-4 py-2.5 text-sm text-charcoal/70">
                <span>{t(`${KEY}.draft.restored`)}</span>
                <button
                  type="button"
                  onClick={discardDraft}
                  className="cursor-pointer font-medium text-charcoal underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta rounded-chip"
                >
                  {t(`${KEY}.draft.discard`)}
                </button>
              </div>
            </div>
          </div>

          <FormSection title={t(`${KEY}.sections.info.title`)} description={t(`${KEY}.sections.info.description`)}>
            <SectionReveal loading={!catalogReady} skeleton={INFO_SKELETON}>
              {catalog && (
                <div className="flex flex-col gap-5">
                  <div className="reveal-item">
                    <CustomInputForm<CreateProductFormType>
                      id="product-name"
                      name="name"
                      type="text"
                      label={t(`${KEY}.fields.nameLabel`)}
                      placeholder={t(`${KEY}.fields.namePlaceholder`)}
                      aria-label={t(`${KEY}.fields.nameLabel`)}
                    />
                  </div>
                  <div className="reveal-item">
                    <CustomTextareaForm<CreateProductFormType>
                      id="product-description"
                      name="description"
                      autoGrow
                      optionalLabel
                      label={t(`${KEY}.fields.descriptionLabel`)}
                      placeholder={t(`${KEY}.fields.descriptionPlaceholder`)}
                      aria-label={t(`${KEY}.fields.descriptionLabel`)}
                    />
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="reveal-item min-w-0">
                      <CustomSelectForm<CreateProductFormType>
                        id="product-business-type"
                        name="businessTypeId"
                        label={t(`${KEY}.fields.businessTypeLabel`)}
                        options={toOptions(catalog.businessTypes)}
                      />
                    </div>
                    <div className="reveal-item min-w-0">
                      <CustomSelectForm<CreateProductFormType>
                        id="product-category"
                        name="categoryId"
                        label={t(`${KEY}.fields.categoryLabel`)}
                        placeholderOption={t(`${KEY}.fields.categoryPlaceholder`)}
                        options={toOptions(catalog.categories)}
                      />
                    </div>
                  </div>
                  <div className="reveal-item">
                    <CustomSelectForm<CreateProductFormType>
                      id="product-currency"
                      name="currencyId"
                      label={t(`${KEY}.fields.currencyLabel`)}
                      options={toCurrencyOptions(catalog.currencies)}
                    />
                  </div>
                </div>
              )}
            </SectionReveal>
          </FormSection>

          <FormSection
            title={t(`${KEY}.sections.photos.title`)}
            description={t(`${KEY}.sections.photos.description`)}
          >
            <SectionReveal
              loading={!catalogReady}
              delaySeconds={SECTION_REVEAL_STEP}
              skeleton={PHOTOS_SKELETON}
            >
              <div className="reveal-item">
                <ProductImageGallery
                  gallery={gallery}
                  disabled={isBusy}
                  progress={progress}
                  isUploading={isUploading}
                />
              </div>
            </SectionReveal>
          </FormSection>

          <FormSection
            title={t(`${KEY}.sections.pricing.title`)}
            description={t(`${KEY}.sections.pricing.description`)}
          >
            <SectionReveal
              loading={!catalogReady}
              delaySeconds={SECTION_REVEAL_STEP * 2}
              skeleton={PRICING_SKELETON}
            >
              {catalog && (
                <div className="flex flex-col gap-5">
                  {/* Conditional pricing: the visible fields follow the business type; a switch
                      clears the hidden side (see the effect above), so stale values can never
                      submit. */}
                  {isRent ? (
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="reveal-item min-w-0">
                        <CustomInputForm<CreateProductFormType>
                          id="product-rent-price"
                          name="rentPrice"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          label={t(`${KEY}.fields.rentPriceLabel`)}
                          placeholder={t(`${KEY}.fields.pricePlaceholder`)}
                          aria-label={t(`${KEY}.fields.rentPriceLabel`)}
                        />
                      </div>
                      <div className="reveal-item min-w-0">
                        <CustomSelectForm<CreateProductFormType>
                          id="product-rent-time-unit"
                          name="rentTimeUnitId"
                          label={t(`${KEY}.fields.rentTimeUnitLabel`)}
                          options={toOptions(catalog.rentTimeUnits)}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="reveal-item">
                      <CustomInputForm<CreateProductFormType>
                        id="product-sell-price"
                        name="sellPrice"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        label={t(`${KEY}.fields.sellPriceLabel`)}
                        placeholder={t(`${KEY}.fields.pricePlaceholder`)}
                        aria-label={t(`${KEY}.fields.sellPriceLabel`)}
                      />
                    </div>
                  )}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="reveal-item min-w-0">
                      <CustomInputForm<CreateProductFormType>
                        id="product-replacement-price"
                        name="replacementPrice"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        optionalLabel
                        label={t(`${KEY}.fields.replacementPriceLabel`)}
                        placeholder={t(`${KEY}.fields.pricePlaceholder`)}
                        aria-label={t(`${KEY}.fields.replacementPriceLabel`)}
                        instructions={t(`${KEY}.fields.replacementPriceHint`)}
                      />
                    </div>
                    <div className="reveal-item min-w-0">
                      <CustomInputForm<CreateProductFormType>
                        id="product-quantity"
                        name="quantity"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        label={t(`${KEY}.fields.quantityLabel`)}
                        placeholder={t(`${KEY}.fields.quantityPlaceholder`)}
                        aria-label={t(`${KEY}.fields.quantityLabel`)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </SectionReveal>
          </FormSection>

          <FormSection
            title={t(`${KEY}.sections.details.title`)}
            description={t(`${KEY}.sections.details.description`)}
          >
            <SectionReveal
              loading={!catalogReady}
              delaySeconds={SECTION_REVEAL_STEP * 3}
              skeleton={DETAILS_SKELETON}
            >
              {catalog && (
                <div className="flex flex-col gap-5">
                  {details.fields.map((row, index) => (
                    <DetailRow
                      key={row.id}
                      animateIn={!initialDetailIds.has(row.id)}
                      onRegister={(el) => {
                        if (el) detailRowRefs.current.set(row.id, el);
                        else detailRowRefs.current.delete(row.id);
                      }}
                    >
                      <div className="grid min-w-0 flex-1 gap-5 sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)]">
                        <CustomSelectForm<CreateProductFormType>
                          id={`product-detail-type-${index}`}
                          name={`details.${index}.detailTypeId`}
                          label={t(`${KEY}.fields.detailTypeLabel`)}
                          placeholderOption={t(`${KEY}.fields.detailTypePlaceholder`)}
                          options={toOptions(
                            catalog.detailTypes.filter(
                              (type) =>
                                type.id === detailValues?.[index]?.detailTypeId ||
                                !usedDetailTypeIds.has(type.id),
                            ),
                          )}
                        />
                        <CustomInputForm<CreateProductFormType>
                          id={`product-detail-value-${index}`}
                          name={`details.${index}.detail`}
                          type="text"
                          label={t(`${KEY}.fields.detailValueLabel`)}
                          placeholder={t(`${KEY}.fields.detailValuePlaceholder`)}
                          aria-label={t(`${KEY}.fields.detailValueLabel`)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeDetail(row.id)}
                        aria-label={t(`${KEY}.actions.removeDetail`)}
                        className="mt-1.5 grid size-9 shrink-0 cursor-pointer place-items-center rounded-chip text-charcoal/45 transition-[color,background-color,box-shadow] duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
                      >
                        <HiOutlineTrash aria-hidden className="size-4.5" />
                      </button>
                    </DetailRow>
                  ))}
                  <div className="reveal-item self-start">
                    <Button
                      variant="soft"
                      color={SECONDARY_COLOR}
                      size="sm"
                      disabled={details.fields.length >= catalog.detailTypes.length}
                      startIcon={<HiOutlinePlus className="size-4" />}
                      // `shouldFocus: false`: RHF's default insta-focus would fire the select's
                      // focus styles mid-entrance — let the row settle; keyboard users Tab in.
                      onClick={() =>
                        details.append(
                          { detailTypeId: null as unknown as number, detail: '' },
                          { shouldFocus: false },
                        )
                      }
                    >
                      {t(`${KEY}.actions.addDetail`)}
                    </Button>
                  </div>
                </div>
              )}
            </SectionReveal>
          </FormSection>

          <div className="reveal-block flex flex-col">
            <FormError id="create-product-error" message={formError} />
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                fullWidth
                disabled={isBusy}
                onClick={() => panelNavigate('/panel/productos')}
                className="sm:w-auto"
              >
                {t(`${KEY}.actions.cancel`)}
              </Button>
              <Button
                type="submit"
                form={FORM_ID}
                color={SECONDARY_COLOR}
                fullWidth
                disabled={isLoading}
                loading={isBusy}
                className="sm:w-auto"
              >
                {isUploading ? t(`${KEY}.actions.uploading`) : t(`${KEY}.actions.submit`)}
              </Button>
            </div>
          </div>
        </form>
      </FormProvider>
    </RequiredPatternsContext.Provider>
    </div>
  );
};

export default ProductForm;
