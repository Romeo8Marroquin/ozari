import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi2';
import Button from '@components/Button';
import CustomInputForm from '@components/CustomInputForm';
import CustomSelectForm from '@components/CustomSelectForm';
import CustomTextareaForm from '@components/CustomTextareaForm';
import FormError from '@components/FormError';
import LocationField from '@components/LocationField';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import Radio from '@components/Radio';
import { CHANNEL_INPUT_MODE, contactChannelKind } from '@constants/Regex';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { toFormError } from '@utils/apiError';
import ContactChannelIcon from './ContactChannelIcon';
import { detailRowIn, detailRowOut, revealInScroller } from '../pageMotion';
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
import { useUpdateClientRegistry } from './useUpdateClientRegistry';

const FORM_ID = 'create-registry-form';
const KEY = 'modules.panel.orders.registry';
const SECONDARY_COLOR = '#262626';

interface ClientRegistryModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the saved registry (created OR updated) so the caller can cache + select it. */
  onCreated: (registry: ClientRegistry) => void;
  /** Present ⇒ EDIT that client instead of creating one. The form prefills from it and saves with
   *  `PUT`, whose body is the same final-state shape as create. */
  registry?: ClientRegistry | undefined;
  contactTypes: CatalogOption[];
  zones: CatalogOption[];
  paymentMethods: CatalogOption[];
}

/**
 * An existing registry → the form's values. The mirror of {@link toCreateRegistryBody}: everything
 * the form owns is restored, so saving an untouched form sends back exactly what is stored.
 *
 * The principal/favorite radios are INDEXES here but flags on the wire, so they are recovered by
 * finding the flagged row — falling back to the first, which is the same defaulting the API applies.
 */
const registryToFormValues = (registry: ClientRegistry): CreateRegistryFormType => ({
  name: registry.name,
  notes: registry.notes ?? '',
  contacts: registry.contacts.map((contact) => ({
    contactTypeId: contact.contactType.id,
    value: contact.value,
  })),
  addresses: registry.addresses.map((address) => ({
    zoneId: address.zone?.id ?? null,
    address: address.address,
    coords: address.coords ?? null,
    instructions: address.instructions ?? '',
  })),
  principalContactIndex: Math.max(
    registry.contacts.findIndex((contact) => contact.isPrincipal),
    0,
  ),
  favoriteAddressIndex: Math.max(
    registry.addresses.findIndex((address) => address.isFavorite),
    0,
  ),
  preferredPaymentMethodId: registry.preferredPaymentMethod?.id ?? null,
});

const toOptions = (rows: CatalogOption[]) => rows.map((row) => ({ value: row.id, label: row.name }));

/**
 * One field-array row (contact or address): registers its element so removal can tween it out, and
 * grows in from the left on mount — but ONLY when `animate` is true, so the DEFAULT rows present when
 * the modal opens ride the modal's own stagger instead of double-animating. Same `detailRowIn`/
 * `detailRowOut` language as the product form's detail sub-editor.
 */
const RegistryRow: React.FC<{
  animate: boolean;
  onRegister: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}> = ({ animate, onRegister, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!animate) return;
    detailRowIn(ref.current);
    // Inside a dialog the scroller is the modal BODY, which `revealInScroller` resolves from the row
    // itself — a contact added at the bottom of a long registry must not appear out of sight.
    revealInScroller(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; `animate` is read once
  }, []);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        onRegister(el);
      }}
      className="flex flex-col gap-2 rounded-control bg-charcoal/[0.02] p-3"
    >
      {children}
    </div>
  );
};

/**
 * Inline "new walk-in client" dialog opened from the order form's client picker. Collects the
 * responsible person's name, 1..N contacts (exactly one principal; the value is validated + the
 * keyboard/icon adapt per channel — WhatsApp/Teléfono/Correo/Otro), 0..N addresses (exactly one
 * favorite; a walk-in may have none and type the venue per order), and an optional preferred payment
 * method. Rows add/remove with the shared row-motion. Owns its errors per the form doctrine
 * (`skipErrorNotification` + `toFormError`): backend validation → inline banner, ambient → toast,
 * outage → silent. On success it hands the projected registry back and closes.
 */
const ClientRegistryModal: React.FC<ClientRegistryModalProps> = ({
  open,
  onClose,
  onCreated,
  registry,
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
  const contactValues = useWatch({ control, name: 'contacts' });
  const addressValues = useWatch({ control, name: 'addresses' });
  const principalIndex = useWatch({ control, name: 'principalContactIndex' });
  const favoriteIndex = useWatch({ control, name: 'favoriteAddressIndex' });
  const { createRegistry, isPending: isCreating } = useCreateClientRegistry();
  const { updateRegistry, isPending: isUpdating } = useUpdateClientRegistry();
  const isEdit = registry !== undefined;
  const isPending = isCreating || isUpdating;
  const [formError, setFormError] = useState<string | undefined>(undefined);

  // Row entrance animates only for rows added AFTER the modal is open — the default rows present on
  // open ride the modal's own reveal (they mount in the first commit, before this effect flips the
  // flag), while rows the admin adds afterwards grow in individually.
  const [rowAnimReady, setRowAnimReady] = useState(false);
  useEffect(() => {
    // Resets the gate on open/close: the DEFAULT rows mount in the first commit (before this passive
    // effect runs) so they read `false` and stay static; rows added afterwards read `true` and grow
    // in. A deliberate effect-driven flag, not derivable during render (it depends on mount order).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional per the note above
    setRowAnimReady(open);
  }, [open]);

  // Element maps + live-field mirrors: a removed row tweens OUT before RHF drops it, using the LIVE
  // index at completion (indices shift as rows leave).
  const contactRefs = useRef(new Map<string, HTMLDivElement>());
  const addressRefs = useRef(new Map<string, HTMLDivElement>());
  const latestContacts = useRef(contacts.fields);
  const latestAddresses = useRef(addresses.fields);
  useEffect(() => {
    latestContacts.current = contacts.fields;
  }, [contacts.fields]);
  useEffect(() => {
    latestAddresses.current = addresses.fields;
  }, [addresses.fields]);

  // A fresh form each time the dialog opens: on close it clears, and on OPEN it loads either the
  // client being edited or the empty defaults. Keyed on `open` so reopening after an edit never
  // shows the previous client's values.
  //
  // LAYOUT effect, deliberately, and it earns both halves of that: it runs BEFORE paint, so the
  // default single contact/address the form mounts with is never seen behind a prefilled edit; and it
  // runs BEFORE the passive `rowAnimReady` flip, so the prefilled rows mount while the gate is still
  // false and ride the modal's own reveal instead of each animating in as if just added.
  useLayoutEffect(() => {
    if (open) reset(registry ? registryToFormValues(registry) : createRegistryDefaultValues);
    else reset();
  }, [open, registry, reset]);

  // Closing clears the inline banner too, so a stale error never greets the next open.
  const close = useCallback((): void => {
    setFormError(undefined);
    onClose();
  }, [onClose]);

  // Removing a row tweens it out, THEN drops it and keeps the single-choice index valid (the removed
  // choice falls back to the first; a choice after the removed row shifts down one).
  const removeContact = (id: string): void => {
    /* v8 ignore next -- `?? null`: a rendered row always has its element registered */
    void detailRowOut(contactRefs.current.get(id) ?? null).then(() => {
      const index = latestContacts.current.findIndex((row) => row.id === id);
      /* v8 ignore next -- defensive: only reachable if the row already left (a raced double-remove) */
      if (index === -1) return;
      const current = getValues('principalContactIndex');
      contacts.remove(index);
      if (current === index) setValue('principalContactIndex', 0);
      else if (current > index) setValue('principalContactIndex', current - 1);
    });
  };
  const removeAddress = (id: string): void => {
    /* v8 ignore next -- `?? null`: a rendered row always has its element registered */
    void detailRowOut(addressRefs.current.get(id) ?? null).then(() => {
      const index = latestAddresses.current.findIndex((row) => row.id === id);
      /* v8 ignore next -- defensive: only reachable if the row already left (a raced double-remove) */
      if (index === -1) return;
      const current = getValues('favoriteAddressIndex');
      addresses.remove(index);
      if (current === index) setValue('favoriteAddressIndex', 0);
      else if (current > index) setValue('favoriteAddressIndex', current - 1);
    });
  };

  const onSubmit = (data: CreateRegistryFormType): void => {
    if (isPending) return;
    setFormError(undefined);
    // ONE body builder for both doors: the API validates create and edit with the same middleware,
    // so the client has no second contract that could drift.
    const body = toCreateRegistryBody(data);
    const handlers = {
      onSuccess: (response: { data: { data?: { registry?: ClientRegistry } } }) => {
        const saved = response.data.data?.registry;
        /* v8 ignore next 4 -- a 2xx always carries the registry; the guard is defensive */
        if (!saved) {
          notify.error(t('errors.generic'));
          return;
        }
        notify.success(t(`${KEY}.${isEdit ? 'updatedToast' : 'successToast'}`), {
          title: t(`${KEY}.${isEdit ? 'updatedTitle' : 'successTitle'}`),
        });
        onCreated(saved);
        close();
      },
      onError: (error: unknown) => {
        const { inline, toast } = toFormError(error, t(`${KEY}.errors.submitFallback`));
        if (inline) setFormError(inline);
        if (toast) notify.error(toast);
      },
    };
    if (registry) {
      updateRegistry({ id: registry.id, body }, handlers);
      return;
    }
    createRegistry(body, handlers);
  };

  const requiredPatternsValue = useMemo(
    () => ({ requiredPatterns: createRegistryRequiredPatterns }),
    [],
  );

  return (
    <Modal
      open={open}
      onClose={close}
      size="xl"
      locked={isPending}
      title={t(`${KEY}.${isEdit ? 'editTitle' : 'title'}`)}
      description={t(`${KEY}.${isEdit ? 'editDescription' : 'description'}`)}
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
            {t(`${KEY}.${isEdit ? 'submitEdit' : 'submit'}`)}
          </Button>
        </>
      }
    >
      <RequiredPatternsContext.Provider value={requiredPatternsValue}>
        <FormProvider {...methods}>
          <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
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

            {/* CONTACTS — ≥1, exactly one principal; keyboard + icon adapt per channel. */}
            <div className="modal-stagger flex flex-col gap-5">
              <div className="flex items-center justify-between gap-3">
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
              {contacts.fields.map((field, index) => {
                const kind = contactChannelKind(contactValues?.[index]?.contactTypeId);
                return (
                  <RegistryRow
                    key={field.id}
                    animate={rowAnimReady}
                    onRegister={(el) => {
                      if (el) contactRefs.current.set(field.id, el);
                      else contactRefs.current.delete(field.id);
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {/* Columns stay tight; only the ROW gap grows, and only below `sm` is there a
                          row at all — which is exactly where the two fields stack. */}
                      <div className="grid min-w-0 flex-1 gap-x-2 gap-y-field sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
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
                          inputMode={CHANNEL_INPUT_MODE[kind]}
                          autoCapitalize={kind === 'email' ? 'none' : undefined}
                          autoCorrect={kind === 'email' ? 'off' : undefined}
                          icon={<ContactChannelIcon kind={kind} />}
                          label={t(`${KEY}.fields.contactValueLabel`)}
                          placeholder={t(`${KEY}.fields.contactValuePlaceholder`)}
                          aria-label={t(`${KEY}.fields.contactValueLabel`)}
                        />
                      </div>
                      {/* Always rendered (no abrupt appear/disappear): disabled — with a smooth color
                          fade — while it's the only contact, since ≥1 is required. */}
                      <button
                        type="button"
                        onClick={() => removeContact(field.id)}
                        disabled={contacts.fields.length <= 1}
                        aria-label={t(`${KEY}.actions.removeContact`)}
                        className="mt-1.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-chip text-charcoal/45 transition-[color,background-color] duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta disabled:cursor-not-allowed disabled:text-charcoal/15 disabled:hover:bg-transparent disabled:hover:text-charcoal/15"
                      >
                        <HiOutlineTrash aria-hidden className="size-4" />
                      </button>
                    </div>
                    <Radio
                      name={`registry-principal-${field.id}`}
                      checked={principalIndex === index}
                      onChange={() => setValue('principalContactIndex', index)}
                      label={t(`${KEY}.fields.principalContact`)}
                    />
                  </RegistryRow>
                );
              })}
            </div>

            {/* ADDRESSES — 0..N, exactly one favorite when any. */}
            <div className="modal-stagger flex flex-col gap-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-charcoal/80">{t(`${KEY}.fields.addressesLabel`)}</span>
                <Button
                  variant="soft"
                  color={SECONDARY_COLOR}
                  size="sm"
                  disabled={addresses.fields.length >= REGISTRY_MAX_ADDRESSES}
                  startIcon={<HiOutlinePlus className="size-3.5" />}
                  onClick={() =>
                    addresses.append({ zoneId: null, address: '', coords: null, instructions: '' })
                  }
                >
                  {t(`${KEY}.actions.addAddress`)}
                </Button>
              </div>
              {addresses.fields.length === 0 && (
                <p className="text-xs text-charcoal/45">{t(`${KEY}.fields.addressesEmpty`)}</p>
              )}
              {addresses.fields.map((field, index) => (
                <RegistryRow
                  key={field.id}
                  animate={rowAnimReady}
                  onRegister={(el) => {
                    if (el) addressRefs.current.set(field.id, el);
                    else addressRefs.current.delete(field.id);
                  }}
                >
                  <div className="flex items-start gap-2">
                    {/* `gap-field`: four stacked fields, and the zone select carries a help line
                        that the instructions label below it was landing on top of. */}
                    <div className="flex min-w-0 flex-1 flex-col gap-field">
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
                      {/* What a pin cannot say: how to get IN once you are there. */}
                      <CustomInputForm<CreateRegistryFormType>
                        id={`registry-instructions-${index}`}
                        name={`addresses.${index}.instructions`}
                        type="text"
                        optionalLabel
                        label={t(`${KEY}.fields.instructionsLabel`)}
                        placeholder={t(`${KEY}.fields.instructionsPlaceholder`)}
                      />
                      {/* Saved on the CLIENT's address, so every future order for this venue starts
                          with the pin already found — the order still snapshots its own copy. */}
                      <LocationField
                        id={`registry-coords-${index}`}
                        value={addressValues?.[index]?.coords ?? undefined}
                        onChange={(coords) =>
                          setValue(`addresses.${index}.coords`, coords ?? null)
                        }
                        addressText={addressValues?.[index]?.address}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAddress(field.id)}
                      aria-label={t(`${KEY}.actions.removeAddress`)}
                      className="mt-1.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-chip text-charcoal/45 transition-[color,background-color] duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
                    >
                      <HiOutlineTrash aria-hidden className="size-4" />
                    </button>
                  </div>
                  <Radio
                    name={`registry-favorite-${field.id}`}
                    checked={favoriteIndex === index}
                    onChange={() => setValue('favoriteAddressIndex', index)}
                    label={t(`${KEY}.fields.favoriteAddress`)}
                  />
                </RegistryRow>
              ))}
            </div>

            {/* Preferred payment method — optional; pre-selects the order's method. */}
            <div className="modal-stagger flex flex-col gap-5">
              <CustomSelectForm<CreateRegistryFormType>
                id="registry-preferred-payment"
                name="preferredPaymentMethodId"
                optionalLabel
                label={t(`${KEY}.fields.preferredPaymentLabel`)}
                placeholderOption={t(`${KEY}.fields.preferredPaymentPlaceholder`)}
                options={toOptions(paymentMethods)}
              />
              {/* Anything about the CLIENT that isn't an address or a phone. Collected here because
                  the save is full-state: a field the API stores but the form never showed would be
                  erased the first time somebody edited the client. */}
              <CustomTextareaForm<CreateRegistryFormType>
                id="registry-notes"
                name="notes"
                autoGrow
                optionalLabel
                label={t(`${KEY}.fields.notesLabel`)}
                placeholder={t(`${KEY}.fields.notesPlaceholder`)}
                aria-label={t(`${KEY}.fields.notesLabel`)}
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
