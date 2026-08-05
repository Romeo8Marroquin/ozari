import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import AnimatedMessage from '@components/AnimatedMessage';
import CustomInput from '@components/CustomInput';
import CustomSelect from '@components/CustomSelect';
import Switch from '@components/Switch';
import { BANK_KEYS, bankLabelKey } from './bankLogos';
import type { CatalogKey, CatalogRow, CatalogRowBody, LookupRow } from './preference.types';

const KEY = 'modules.panel.preferences';
const SECONDARY_COLOR = '#262626';
const NAME_MIN = 2;
const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
/** The bank account's own bounds, mirroring the backend registry's `extraFields`. */
const ACCOUNT_TYPE_MIN = 2;
const ACCOUNT_TYPE_MAX = 40;
const ACCOUNT_NUMBER_MIN = 4;
const ACCOUNT_NUMBER_MAX = 34;
const HOLDER_MIN = 2;
const HOLDER_MAX = 120;

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
 * a bank account gets its bank, type, number and holder, everything else gets just the name, the
 * note and the publication switch. Sending a field the catalog doesn't declare would be dropped
 * server-side anyway; not showing it is the honest half.
 *
 * Validation is local and mirrors the API's bounds (name 2–100, note ≤500, and the bank account's
 * own four) so the admin is corrected as they type rather than by a round-trip. The API remains the
 * authority — including for the two encrypted fields, which are plain text on this side and become
 * ciphertext the moment they are written.
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
  // '' is "sin logo" — a REAL answer here, not an unfilled field: an account at a bank we ship no
  // asset for is perfectly usable and simply prints as text.
  const [bankKey, setBankKey] = useState(row?.bankKey ?? '');
  const [accountType, setAccountType] = useState(row?.accountType ?? '');
  const [accountNumber, setAccountNumber] = useState(row?.accountNumber ?? '');
  const [holder, setHolder] = useState(row?.holder ?? '');
  const [touched, setTouched] = useState(false);

  const isBank = catalog === 'bank-accounts';
  /** A required bank text: the same bounds the API enforces, checked while the admin types. */
  const bankTextError = (value: string, min: number, max: number): string | undefined => {
    const length = value.trim().length;
    return isBank && (length < min || length > max)
      ? t(`${KEY}.rowForm.bankTextError`, { min, max })
      : undefined;
  };

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
  const accountTypeError = bankTextError(accountType, ACCOUNT_TYPE_MIN, ACCOUNT_TYPE_MAX);
  const accountNumberError = bankTextError(accountNumber, ACCOUNT_NUMBER_MIN, ACCOUNT_NUMBER_MAX);
  const holderError = bankTextError(holder, HOLDER_MIN, HOLDER_MAX);
  /** The first thing wrong, in field order — one message for the whole row (see the note below). */
  const firstError =
    nameError ??
    descriptionError ??
    leadError ??
    feeError ??
    municipalityError ??
    accountTypeError ??
    accountNumberError ??
    holderError;
  const invalid = firstError !== undefined;

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
      ...(isBank && {
        // '' becomes null — "sin logo", which the API accepts as the legitimate answer it is.
        bankKey: bankKey === '' ? null : bankKey,
        accountType: accountType.trim(),
        accountNumber: accountNumber.trim(),
        holder: holder.trim(),
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
        {isBank && (
          <>
            {/* "Sin logo" is the placeholder AND a real selection, not a prompt to pick something
                else — so it carries no error state and needs no "selecciona…" copy. */}
            <CustomSelect
              id="preference-row-bank"
              label={t(`${KEY}.rowForm.bank`)}
              aria-label={t(`${KEY}.rowForm.bank`)}
              placeholderOption={t(`${KEY}.rowForm.bankNone`)}
              value={bankKey}
              disabled={busy}
              onChange={(event) => setBankKey(event.target.value)}
              options={BANK_KEYS.map((key) => ({ value: key, label: t(bankLabelKey(key)) }))}
            />
            <CustomInput
              id="preference-row-account-type"
              label={t(`${KEY}.rowForm.accountType`)}
              aria-label={t(`${KEY}.rowForm.accountType`)}
              placeholder={t(`${KEY}.rowForm.accountTypePlaceholder`)}
              value={accountType}
              disabled={busy}
              onChange={(event) => setAccountType(event.target.value)}
              error={showError(accountTypeError) !== undefined}
            />
            <CustomInput
              id="preference-row-account-number"
              label={t(`${KEY}.rowForm.accountNumber`)}
              aria-label={t(`${KEY}.rowForm.accountNumber`)}
              // `inputMode` only, never `type="number"`: account numbers carry dashes and leading
              // zeros, both of which a numeric input would eat.
              inputMode="numeric"
              value={accountNumber}
              disabled={busy}
              onChange={(event) => setAccountNumber(event.target.value)}
              error={showError(accountNumberError) !== undefined}
            />
            <CustomInput
              id="preference-row-holder"
              label={t(`${KEY}.rowForm.holder`)}
              aria-label={t(`${KEY}.rowForm.holder`)}
              value={holder}
              disabled={busy}
              onChange={(event) => setHolder(event.target.value)}
              error={showError(holderError) !== undefined}
            />
          </>
        )}
      </div>

      {/* ONE explanation for the whole row rather than a slot under each field: the offending field
          is already marked red, and a reserved message line under every field in an inline editor
          would push the rows below it around every time one appeared. */}
      <AnimatedMessage
        id="preference-row-error"
        {...(touched && { errorMessage: firstError })}
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
