import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
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
}

const toOptions = (rows: CatalogOption[]) => rows.map((row) => ({ value: row.id, label: row.name }));

/**
 * Inline "new walk-in client" dialog opened from the order form's client picker. First-version
 * scope: a name, ONE contact (type + value), and ONE address (text + optional zone) — the common
 * case; the backend accepts 1–10 of each (multi is a documented fast-follow). Owns its errors per
 * the form doctrine (`skipErrorNotification` + `toFormError`): backend validation lands in the
 * inline banner, ambient failures toast, an outage goes silent. On success it hands the projected
 * registry back and closes.
 */
const ClientRegistryModal: React.FC<ClientRegistryModalProps> = ({
  open,
  onClose,
  onCreated,
  contactTypes,
  zones,
}) => {
  const { t } = useTranslation();
  const methods = useForm<CreateRegistryFormType>({
    resolver: zodResolver(createRegistrySchema),
    defaultValues: createRegistryDefaultValues,
    mode: 'onTouched',
  });
  const { handleSubmit, reset } = methods;
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
          <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
            <div className="modal-stagger grid gap-4 sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)]">
              <CustomSelectForm<CreateRegistryFormType>
                id="registry-contact-type"
                name="contactTypeId"
                label={t(`${KEY}.fields.contactTypeLabel`)}
                placeholderOption={t(`${KEY}.fields.contactTypePlaceholder`)}
                options={toOptions(contactTypes)}
              />
              <CustomInputForm<CreateRegistryFormType>
                id="registry-contact-value"
                name="contactValue"
                type="text"
                label={t(`${KEY}.fields.contactValueLabel`)}
                placeholder={t(`${KEY}.fields.contactValuePlaceholder`)}
                aria-label={t(`${KEY}.fields.contactValueLabel`)}
              />
            </div>
            <div className="modal-stagger">
              <CustomTextareaForm<CreateRegistryFormType>
                id="registry-address"
                name="address"
                autoGrow
                label={t(`${KEY}.fields.addressLabel`)}
                placeholder={t(`${KEY}.fields.addressPlaceholder`)}
                aria-label={t(`${KEY}.fields.addressLabel`)}
              />
            </div>
            <div className="modal-stagger">
              <CustomSelectForm<CreateRegistryFormType>
                id="registry-zone"
                name="zoneId"
                optionalLabel
                label={t(`${KEY}.fields.zoneLabel`)}
                placeholderOption={t(`${KEY}.fields.zonePlaceholder`)}
                options={toOptions(zones)}
                instructions={t(`${KEY}.fields.zoneHint`)}
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
