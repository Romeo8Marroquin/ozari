import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi2';
import Button from '@components/Button';
import CustomInputForm from '@components/CustomInputForm';
import CustomSelectForm from '@components/CustomSelectForm';
import CustomTextareaForm from '@components/CustomTextareaForm';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { toFormError } from '@utils/apiError';
import type { CatalogOption, ClientRegistry } from './order.types';
import {
  createRegistryDefaultValues,
  createRegistryRequiredPatterns,
  createRegistrySchema,
  REGISTRY_MAX_ADDRESSES,
  REGISTRY_MAX_CONTACTS,
  toCreateRegistryBody,
  type CreateRegistryFormType,
} from './SchemaCreateRegistry';
import { useCreateClientRegistry } from './useCreateClientRegistry';

const FORM_ID = 'create-registry-form';
const KEY = 'modules.panel.orders.registry';
const SECONDARY_COLOR = '#262626';

interface ClientRegistryModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the freshly-created registry so the caller can cache + select it. */
  onCreated: (registry: ClientRegistry) => void;
  contactTypes: CatalogOption[];
  zones: CatalogOption[];
  paymentMethods: CatalogOption[];
}

const toOptions = (rows: CatalogOption[]) => rows.map((row) => ({ value: row.id, label: row.name }));

/** The principal/favorite radio — a single choice across a list (exactly one). */
const ChoiceRadio: React.FC<{
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}> = ({ name, checked, onChange, label }) => (
  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-charcoal/60">
    <input
      type="radio"
      name={name}
      checked={checked}
      onChange={onChange}
      className="size-3.5 cursor-pointer accent-charcoal"
    />
    {label}
  </label>
);

/**
 * Inline "new walk-in client" dialog opened from the order form's client picker. Collects the
 * responsible person's name, 1..N contacts (exactly one principal), 0..N addresses (exactly one
 * favorite; a walk-in may have none and type the venue per order), and an optional preferred
 * payment method. Owns its errors per the form doctrine (`skipErrorNotification` + `toFormError`):
 * backend validation lands in the inline banner, ambient failures toast, an outage goes silent. On
 * success it hands the projected registry back and closes.
 */
const ClientRegistryModal: React.FC<ClientRegistryModalProps> = ({
  open,
  onClose,
  onCreated,
  contactTypes,
  zones,
  paymentMethods,
}) => {
  const { t } = useTranslation();
  const methods = useForm<CreateRegistryFormType>({
    resolver: zodResolver(createRegistrySchema),
    defaultValues: createRegistryDefaultValues,
    mode: 'onTouched',
  });
  const { handleSubmit, reset, control, getValues, setValue } = methods;
  const contacts = useFieldArray({ control, name: 'contacts' });
  const addresses = useFieldArray({ control, name: 'addresses' });
  const principalIndex = useWatch({ control, name: 'principalContactIndex' });
  const favoriteIndex = useWatch({ control, name: 'favoriteAddressIndex' });
  const { createRegistry, isPending } = useCreateClientRegistry();
  const [formError, setFormError] = useState<string | undefined>(undefined);

  // A fresh form each time the dialog opens — clear typed values + field errors on close (reset is
  // an RHF call, safe in an effect; the banner is cleared in `close`, an event handler).
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Closing clears the inline banner too, so a stale error never greets the next open.
  const close = useCallback((): void => {
    setFormError(undefined);
    onClose();
  }, [onClose]);

  // Removing a row keeps the single-choice index valid: the removed choice falls back to the first,
  // and a choice after the removed row shifts down one.
  const removeContact = (index: number): void => {
    const current = getValues('principalContactIndex');
    contacts.remove(index);
    if (current === index) setValue('principalContactIndex', 0);
    else if (current > index) setValue('principalContactIndex', current - 1);
  };
  const removeAddress = (index: number): void => {
    const current = getValues('favoriteAddressIndex');
    addresses.remove(index);
    if (current === index) setValue('favoriteAddressIndex', 0);
    else if (current > index) setValue('favoriteAddressIndex', current - 1);
  };

  const onSubmit = (data: CreateRegistryFormType): void => {
    if (isPending) return;
    setFormError(undefined);
    createRegistry(toCreateRegistryBody(data), {
      onSuccess: (response) => {
        const registry = response.data.data?.registry;
        /* v8 ignore next 4 -- a 2xx always carries the registry; the guard is defensive */
        if (!registry) {
          notify.error(t('errors.generic'));
          return;
        }
        notify.success(t(`${KEY}.successToast`), { title: t(`${KEY}.successTitle`) });
        onCreated(registry);
        close();
      },
      onError: (error) => {
        const { inline, toast } = toFormError(error, t(`${KEY}.errors.submitFallback`));
        if (inline) setFormError(inline);
        if (toast) notify.error(toast);
      },
    });
  };

  const requiredPatternsValue = useMemo(
    () => ({ requiredPatterns: createRegistryRequiredPatterns }),
    [],
  );

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      locked={isPending}
      title={t(`${KEY}.title`)}
      description={t(`${KEY}.description`)}
      footer={
        <>
          <Button
            variant="soft"
            color={SECONDARY_COLOR}
            fullWidth
            onClick={close}
            disabled={isPending}
            className="sm:w-auto"
          >
            {t(`${KEY}.cancel`)}
          </Button>
          <Button type="submit" form={FORM_ID} color={SECONDARY_COLOR} fullWidth loading={isPending} className="sm:w-auto">
            {t(`${KEY}.submit`)}
          </Button>
        </>
      }
    >
      <RequiredPatternsContext.Provider value={requiredPatternsValue}>
        <FormProvider {...methods}>
          <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
            <div className="modal-stagger">
              <CustomInputForm<CreateRegistryFormType>
                id="registry-name"
                name="name"
                type="text"
                data-modal-autofocus
                label={t(`${KEY}.fields.nameLabel`)}
                placeholder={t(`${KEY}.fields.namePlaceholder`)}
                aria-label={t(`${KEY}.fields.nameLabel`)}
              />
            </div>

            {/* CONTACTS — ≥1, exactly one principal. */}
            <div className="modal-stagger flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-charcoal/80">{t(`${KEY}.fields.contactsLabel`)}</span>
                <Button
                  variant="soft"
                  color={SECONDARY_COLOR}
                  size="sm"
                  disabled={contacts.fields.length >= REGISTRY_MAX_CONTACTS}
                  startIcon={<HiOutlinePlus className="size-3.5" />}
                  onClick={() => contacts.append({ contactTypeId: null as unknown as number, value: '' })}
                >
                  {t(`${KEY}.actions.addContact`)}
                </Button>
              </div>
              {contacts.fields.map((field, index) => (
                <div key={field.id} className="flex flex-col gap-2 rounded-control bg-charcoal/[0.02] p-3">
                  <div className="flex items-start gap-2">
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,170px)_minmax(0,1fr)]">
                      <CustomSelectForm<CreateRegistryFormType>
                        id={`registry-contact-type-${index}`}
                        name={`contacts.${index}.contactTypeId`}
                        label={t(`${KEY}.fields.contactTypeLabel`)}
                        placeholderOption={t(`${KEY}.fields.contactTypePlaceholder`)}
                        options={toOptions(contactTypes)}
                      />
                      <CustomInputForm<CreateRegistryFormType>
                        id={`registry-contact-value-${index}`}
                        name={`contacts.${index}.value`}
                        type="text"
                        label={t(`${KEY}.fields.contactValueLabel`)}
                        placeholder={t(`${KEY}.fields.contactValuePlaceholder`)}
                        aria-label={t(`${KEY}.fields.contactValueLabel`)}
                      />
                    </div>
                    {contacts.fields.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeContact(index)}
                        aria-label={t(`${KEY}.actions.removeContact`)}
                        className="mt-1.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-chip text-charcoal/45 transition-[color,background-color] duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
                      >
                        <HiOutlineTrash aria-hidden className="size-4" />
                      </button>
                    )}
                  </div>
                  <ChoiceRadio
                    name="registry-principal-contact"
                    checked={principalIndex === index}
                    onChange={() => setValue('principalContactIndex', index)}
                    label={t(`${KEY}.fields.principalContact`)}
                  />
                </div>
              ))}
            </div>

            {/* ADDRESSES — 0..N, exactly one favorite when any. */}
            <div className="modal-stagger flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-charcoal/80">{t(`${KEY}.fields.addressesLabel`)}</span>
                <Button
                  variant="soft"
                  color={SECONDARY_COLOR}
                  size="sm"
                  disabled={addresses.fields.length >= REGISTRY_MAX_ADDRESSES}
                  startIcon={<HiOutlinePlus className="size-3.5" />}
                  onClick={() => addresses.append({ zoneId: null, address: '' })}
                >
                  {t(`${KEY}.actions.addAddress`)}
                </Button>
              </div>
              {addresses.fields.length === 0 && (
                <p className="text-xs text-charcoal/45">{t(`${KEY}.fields.addressesEmpty`)}</p>
              )}
              {addresses.fields.map((field, index) => (
                <div key={field.id} className="flex flex-col gap-2 rounded-control bg-charcoal/[0.02] p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <CustomTextareaForm<CreateRegistryFormType>
                        id={`registry-address-${index}`}
                        name={`addresses.${index}.address`}
                        autoGrow
                        label={t(`${KEY}.fields.addressLabel`)}
                        placeholder={t(`${KEY}.fields.addressPlaceholder`)}
                        aria-label={t(`${KEY}.fields.addressLabel`)}
                      />
                      <CustomSelectForm<CreateRegistryFormType>
                        id={`registry-zone-${index}`}
                        name={`addresses.${index}.zoneId`}
                        optionalLabel
                        label={t(`${KEY}.fields.zoneLabel`)}
                        placeholderOption={t(`${KEY}.fields.zonePlaceholder`)}
                        options={toOptions(zones)}
                        instructions={t(`${KEY}.fields.zoneHint`)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAddress(index)}
                      aria-label={t(`${KEY}.actions.removeAddress`)}
                      className="mt-1.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-chip text-charcoal/45 transition-[color,background-color] duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
                    >
                      <HiOutlineTrash aria-hidden className="size-4" />
                    </button>
                  </div>
                  <ChoiceRadio
                    name="registry-favorite-address"
                    checked={favoriteIndex === index}
                    onChange={() => setValue('favoriteAddressIndex', index)}
                    label={t(`${KEY}.fields.favoriteAddress`)}
                  />
                </div>
              ))}
            </div>

            {/* Preferred payment method — optional; pre-selects the order's method. */}
            <div className="modal-stagger">
              <CustomSelectForm<CreateRegistryFormType>
                id="registry-preferred-payment"
                name="preferredPaymentMethodId"
                optionalLabel
                label={t(`${KEY}.fields.preferredPaymentLabel`)}
                placeholderOption={t(`${KEY}.fields.preferredPaymentPlaceholder`)}
                options={toOptions(paymentMethods)}
              />
            </div>

            <FormError id="create-registry-error" message={formError} />
          </form>
        </FormProvider>
      </RequiredPatternsContext.Provider>
    </Modal>
  );
};

export default ClientRegistryModal;
