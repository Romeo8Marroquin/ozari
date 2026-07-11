import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { usePanelNavigate } from '../PanelNavContext';
import type { CatalogOption, CurrencyCatalogOption } from './product.types';
import {
  clearProductDraft,
  isMeaningfulDraft,
  readProductDraft,
  saveProductDraft,
} from './productDraft';
import ProductsStatus from './ProductsStatus';
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

/**
 * The product create form. Owns its errors per the form doctrine (`skipErrorNotification` +
 * `toFormError`): backend validation lands in the form-level banner, ambient failures toast, an
 * outage goes silent (the overlay owns it). Work is protected by a SILENT sessionStorage draft —
 * autosaved on every change, restored on return with a visible note + explicit discard, cleared on
 * a successful create (and on logout via `clearAuthState`). No blocking "leave?" dialogs, ever.
 */
const ProductForm: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const queryClient = useQueryClient();
  const { data: catalog, isLoading, isError, isFetching, refetch } = useProductCatalog();
  const { createProduct, isPending } = useCreateProduct();
  const [formError, setFormError] = useState<string | undefined>(undefined);

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
    clearProductDraft();
    reset(createProductDefaultValues);
    setDraftRestored(false);
  };

  const onSubmit = (data: CreateProductFormType): void => {
    if (isPending) return;
    setFormError(undefined);
    createProduct(toCreateProductBody(data), {
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
    });
  };

  const requiredPatternsValue = useMemo(
    () => ({ requiredPatterns: createProductRequiredPatterns }),
    [],
  );

  // Reference data still loading → skeleton section shells (same shimmer language as settings),
  // so the page's entrance has real surfaces to reveal and nothing pops on arrival.
  if (isLoading) {
    return (
      <div className="flex flex-col gap-6" role="status" aria-label={t(`${KEY}.loading`)}>
        {[0, 1].map((section) => (
          <div
            key={section}
            className="reveal-block rounded-card border border-charcoal/[0.07] bg-white px-5 py-5 shadow-sm sm:px-6"
          >
            <span aria-hidden className={`block h-4 w-40 ${SKELETON}`} />
            <span aria-hidden className={`mt-3 block h-3 w-64 max-w-full ${SKELETON}`} />
            <span aria-hidden className={`mt-6 block h-9 w-full ${SKELETON}`} />
            <span aria-hidden className={`mt-4 block h-9 w-full ${SKELETON}`} />
          </div>
        ))}
      </div>
    );
  }

  // Cold catalog failure → an honest retry panel; the form never renders with empty selects.
  if (isError || !catalog) {
    return (
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
    );
  }

  return (
    <RequiredPatternsContext.Provider value={requiredPatternsValue}>
      <FormProvider {...methods}>
        <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
          {/* Restored-draft note: visible, dismissible, never blocking. */}
          {draftRestored && (
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
          )}

          <FormSection title={t(`${KEY}.sections.info.title`)} description={t(`${KEY}.sections.info.description`)}>
            <div className="flex flex-col gap-5">
              <CustomInputForm<CreateProductFormType>
                id="product-name"
                name="name"
                type="text"
                label={t(`${KEY}.fields.nameLabel`)}
                placeholder={t(`${KEY}.fields.namePlaceholder`)}
                aria-label={t(`${KEY}.fields.nameLabel`)}
              />
              <CustomTextareaForm<CreateProductFormType>
                id="product-description"
                name="description"
                rows={3}
                optionalLabel
                label={t(`${KEY}.fields.descriptionLabel`)}
                placeholder={t(`${KEY}.fields.descriptionPlaceholder`)}
                aria-label={t(`${KEY}.fields.descriptionLabel`)}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <CustomSelectForm<CreateProductFormType>
                  id="product-business-type"
                  name="businessTypeId"
                  label={t(`${KEY}.fields.businessTypeLabel`)}
                  options={toOptions(catalog.businessTypes)}
                />
                <CustomSelectForm<CreateProductFormType>
                  id="product-category"
                  name="categoryId"
                  label={t(`${KEY}.fields.categoryLabel`)}
                  placeholderOption={t(`${KEY}.fields.categoryPlaceholder`)}
                  options={toOptions(catalog.categories)}
                />
              </div>
              <CustomSelectForm<CreateProductFormType>
                id="product-currency"
                name="currencyId"
                label={t(`${KEY}.fields.currencyLabel`)}
                options={toCurrencyOptions(catalog.currencies)}
              />
            </div>
          </FormSection>

          <FormSection
            title={t(`${KEY}.sections.pricing.title`)}
            description={t(`${KEY}.sections.pricing.description`)}
          >
            <div className="flex flex-col gap-5">
              {/* Conditional pricing: the visible fields follow the business type; a switch clears
                  the hidden side (see the effect above), so stale values can never submit. */}
              {isRent ? (
                <div className="grid gap-5 sm:grid-cols-2">
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
                  <CustomSelectForm<CreateProductFormType>
                    id="product-rent-time-unit"
                    name="rentTimeUnitId"
                    label={t(`${KEY}.fields.rentTimeUnitLabel`)}
                    options={toOptions(catalog.rentTimeUnits)}
                  />
                </div>
              ) : (
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
              )}
              <div className="grid gap-5 sm:grid-cols-2">
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
          </FormSection>

          <FormSection
            title={t(`${KEY}.sections.details.title`)}
            description={t(`${KEY}.sections.details.description`)}
          >
            <div className="flex flex-col gap-5">
              {details.fields.map((row, index) => (
                <div key={row.id} className="flex items-start gap-3">
                  <div className="grid min-w-0 flex-1 gap-5 sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)]">
                    <CustomSelectForm<CreateProductFormType>
                      id={`product-detail-type-${index}`}
                      name={`details.${index}.detailTypeId`}
                      label={t(`${KEY}.fields.detailTypeLabel`)}
                      placeholderOption={t(`${KEY}.fields.detailTypePlaceholder`)}
                      options={toOptions(catalog.detailTypes)}
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
                    onClick={() => details.remove(index)}
                    aria-label={t(`${KEY}.actions.removeDetail`)}
                    className="mt-1.5 grid size-9 shrink-0 cursor-pointer place-items-center rounded-control text-charcoal/45 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
                  >
                    <HiOutlineTrash aria-hidden className="size-4.5" />
                  </button>
                </div>
              ))}
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                size="sm"
                className="self-start"
                startIcon={<HiOutlinePlus className="size-4" />}
                onClick={() => details.append({ detailTypeId: null as unknown as number, detail: '' })}
              >
                {t(`${KEY}.actions.addDetail`)}
              </Button>
            </div>
          </FormSection>

          <div className="reveal-block flex flex-col">
            <FormError id="create-product-error" message={formError} />
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                fullWidth
                disabled={isPending}
                onClick={() => panelNavigate('/panel/productos')}
                className="sm:w-auto"
              >
                {t(`${KEY}.actions.cancel`)}
              </Button>
              <Button type="submit" form={FORM_ID} color={SECONDARY_COLOR} fullWidth loading={isPending} className="sm:w-auto">
                {t(`${KEY}.actions.submit`)}
              </Button>
            </div>
          </div>
        </form>
      </FormProvider>
    </RequiredPatternsContext.Provider>
  );
};

export default ProductForm;
