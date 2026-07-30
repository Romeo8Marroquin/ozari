import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import AnimatedMessage from '@components/AnimatedMessage';
import CustomInput from '@components/CustomInput';
import CustomSelect from '@components/CustomSelect';
import Switch from '@components/Switch';
import type { CatalogKey, CatalogRow, CatalogRowBody, LookupRow } from './preference.types';

const KEY = 'modules.panel.preferences';
const SECONDARY_COLOR = '#262626';
const NAME_MIN = 2;
const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;

interface PreferenceRowFormProps {
  catalog: CatalogKey;
  /** The row being edited; absent = a new one. */
  row?: CatalogRow;
  /** Options for the zone form's municipality select. */
  municipalities: LookupRow[];
  busy: boolean;
  onSubmit: (body: CatalogRowBody) => void;
  onCancel: () => void;
}

/**
 * The inline editor for ONE catalog row — the same component for adding and editing, because they
 * describe the same thing and two copies would drift.
 *
 * Which fields appear is driven by the CATALOG, mirroring the backend registry that decides which
 * extras each one accepts: an event type gets its lead time, a zone gets its municipality and fee,
 * everything else gets just the name, the note and the publication switch. Sending a field the
 * catalog doesn't declare would be dropped server-side anyway; not showing it is the honest half.
 *
 * Validation is local and mirrors the API's bounds (name 2–100, note ≤500) so the admin is corrected
 * as they type rather than by a round-trip. The API remains the authority.
 */
const PreferenceRowForm: React.FC<PreferenceRowFormProps> = ({
  catalog,
  row,
  municipalities,
  busy,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [leadHours, setLeadHours] = useState(
    row?.minLeadHours !== undefined ? String(row.minLeadHours) : '24',
  );
  // '' is the "not configured" sentinel — which is NOT 0 (free delivery). Kept as text so the field
  // can be emptied back to "unset" after holding a number.
  const [fee, setFee] = useState(row?.deliveryFee !== undefined ? String(row.deliveryFee) : '');
  const [municipalityId, setMunicipalityId] = useState(
    row?.municipalityId !== undefined ? String(row.municipalityId) : '',
  );
  const [touched, setTouched] = useState(false);

  const trimmedName = name.trim();
  const nameError =
    trimmedName.length < NAME_MIN || trimmedName.length > NAME_MAX
      ? t(`${KEY}.rowForm.nameError`, { min: NAME_MIN, max: NAME_MAX })
      : undefined;
  const descriptionError =
    description.trim().length > DESCRIPTION_MAX
      ? t(`${KEY}.rowForm.descriptionError`, { max: DESCRIPTION_MAX })
      : undefined;
  const leadError =
    catalog === 'event-types' && !/^\d+$/.test(leadHours.trim())
      ? t(`${KEY}.rowForm.leadError`)
      : undefined;
  const feeError =
    catalog === 'zones' && fee.trim() !== '' && !/^\d+(\.\d{1,2})?$/.test(fee.trim())
      ? t(`${KEY}.rowForm.feeError`)
      : undefined;
  const municipalityError =
    catalog === 'zones' && municipalityId === ''
      ? t(`${KEY}.rowForm.municipalityError`)
      : undefined;
  const invalid = Boolean(nameError ?? descriptionError ?? leadError ?? feeError ?? municipalityError);

  const submit = (): void => {
    setTouched(true);
    if (invalid || busy) return;
    const trimmedDescription = description.trim();
    onSubmit({
      name: trimmedName,
      ...(trimmedDescription !== '' && { description: trimmedDescription }),
      isActive,
      ...(catalog === 'event-types' && { minLeadHours: Number(leadHours.trim()) }),
      ...(catalog === 'zones' && {
        municipalityId: Number(municipalityId),
        // Empty stays NULL: "no fee configured" is a real state, distinct from a fee of zero.
        deliveryFee: fee.trim() === '' ? null : Number(fee.trim()),
      }),
    });
  };

  /** Errors only after a submit attempt — nagging while someone types their first character is the
   *  thing the app's field-error language exists to avoid. */
  const showError = (message: string | undefined): string | undefined =>
    touched ? message : undefined;

  return (
    // A real `<form>`, not a styled div: that is the ONLY thing that makes Enter submit from a field.
    // `noValidate` because the bounds here are also expressed as `min`/`max` attributes — without it
    // the browser blocks submission with its own untranslated bubble and our mirrored message (and the
    // `touched` flip that reveals it) never runs, so pressing Enter would appear to do nothing.
    //
    // `py-5`: the same vertical rhythm as the settings cards and the list's own edges, so opening an
    // editor changes the card's height without changing its padding language.
    <form
      className="flex flex-col gap-4 py-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <CustomInput
          id="preference-row-name"
          label={t(`${KEY}.rowForm.name`)}
          aria-label={t(`${KEY}.rowForm.name`)}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          error={showError(nameError) !== undefined}
        />
        <CustomInput
          id="preference-row-description"
          label={t(`${KEY}.rowForm.description`)}
          aria-label={t(`${KEY}.rowForm.description`)}
          value={description}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
          error={showError(descriptionError) !== undefined}
        />
        {catalog === 'event-types' && (
          <CustomInput
            id="preference-row-lead"
            type="number"
            min={0}
            inputMode="numeric"
            label={t(`${KEY}.rowForm.leadHours`)}
            aria-label={t(`${KEY}.rowForm.leadHours`)}
            value={leadHours}
            disabled={busy}
            onChange={(event) => setLeadHours(event.target.value)}
            error={showError(leadError) !== undefined}
          />
        )}
        {catalog === 'zones' && (
          <>
            <CustomSelect
              id="preference-row-municipality"
              label={t(`${KEY}.rowForm.municipality`)}
              aria-label={t(`${KEY}.rowForm.municipality`)}
              placeholderOption={t(`${KEY}.rowForm.municipalityPlaceholder`)}
              value={municipalityId}
              disabled={busy}
              onChange={(event) => setMunicipalityId(event.target.value)}
              options={municipalities.map((municipality) => ({
                value: String(municipality.id),
                label: municipality.name,
              }))}
              error={showError(municipalityError) !== undefined}
            />
            <CustomInput
              id="preference-row-fee"
              inputMode="decimal"
              label={t(`${KEY}.rowForm.fee`)}
              aria-label={t(`${KEY}.rowForm.fee`)}
              placeholder={t(`${KEY}.rowForm.feePlaceholder`)}
              value={fee}
              disabled={busy}
              onChange={(event) => setFee(event.target.value)}
              error={showError(feeError) !== undefined}
            />
          </>
        )}
      </div>

      {/* ONE explanation for the whole row rather than a slot under each field: the offending field
          is already marked red, and five reserved message lines in an inline editor would push the
          rows below it around every time one appeared. */}
      <AnimatedMessage
        id="preference-row-error"
        {...(touched && {
          errorMessage:
            nameError ?? descriptionError ?? leadError ?? feeError ?? municipalityError,
        })}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Switch
          checked={isActive}
          disabled={busy}
          onChange={setIsActive}
          label={t(`${KEY}.rowForm.active`)}
          aria-label={t(`${KEY}.rowForm.active`)}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="soft" color={SECONDARY_COLOR} size="sm" disabled={busy} onClick={onCancel}>
            {t(`${KEY}.rowForm.cancel`)}
          </Button>
          <Button type="submit" color={SECONDARY_COLOR} size="sm" loading={busy}>
            {t(`${KEY}.rowForm.save`)}
          </Button>
        </div>
      </div>
    </form>
  );
};

export default PreferenceRowForm;
