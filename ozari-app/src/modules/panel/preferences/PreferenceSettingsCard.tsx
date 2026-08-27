import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AnimatedMessage from '@components/AnimatedMessage';
import Button from '@components/Button';
import CustomInput from '@components/CustomInput';
import CustomTextarea from '@components/CustomTextarea';
import Switch from '@components/Switch';
import { notify } from '@components/notifications/notify';
import { toFormError } from '@utils/apiError';
import { useUpdatePreferenceSettings } from './usePreferences';
import type { PreferenceSetting } from './preference.types';

const KEY = 'modules.panel.preferences';
const SECONDARY_COLOR = '#262626';

/** `orders.turnaroundMinutes` → `turnaroundMinutes`: the i18n leaf that names and explains it. The
 *  API ships tokens and bounds, never copy — so a setting added server-side appears here as soon as
 *  its two strings exist, with no other frontend change. */
const settingLeaf = (key: string): string => key.slice(key.lastIndexOf('.') + 1);

interface PreferenceSettingsCardProps {
  settings: PreferenceSetting[];
}

/** One field: the setting the API published plus the text currently in its input. */
interface SettingField {
  setting: PreferenceSetting;
  text: string;
}

/**
 * A field's edited TEXT → the value the API expects for that setting's own arm.
 *
 * Every edit is held as a string (an emptied number field has to be able to exist as `''` while it
 * is retyped), so a switch stores `'true'`/`'false'` and converts back here — which is also exactly
 * what `String(setting.value)` produces when the field has not been touched, so the untouched and
 * the edited paths agree without a special case.
 */
const settingWireValue = ({ setting, text }: SettingField): string | number | boolean => {
  if (setting.type === 'bool') return text === 'true';
  return setting.type === 'text' ? text.trim() : Number(text);
};

/**
 * The scalar settings of ONE group, as a small save-on-demand form.
 *
 * The fields are rendered FROM the API's list, with the bounds it published enforced here as the
 * admin types — the mirrored-validation doctrine applied to settings, so a value is corrected in
 * place rather than by a round-trip. The server re-checks and clamps regardless, and the response
 * carries the reloaded values, so what the screen shows afterwards is what the system will read.
 *
 * The save button stays inert until something actually changed: a settings screen that always looks
 * dirty trains people to ignore it.
 */
const PreferenceSettingsCard: React.FC<PreferenceSettingsCardProps> = ({ settings }) => {
  const { t } = useTranslation();
  const { updateSettings, isPending } = useUpdatePreferenceSettings();
  // Only the fields the admin actually TOUCHED are held locally, as text — an emptied field must be
  // able to exist as "" while it is being retyped rather than snapping to 0 under the cursor. Every
  // other field reads straight from the API, so there is no local copy to fall out of date.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  // Drop the edits when the saved values change (our own save, or a refetch) — React's "adjust state
  // during render", so the inputs follow the server without an effect round-trip.
  const savedSignature = settings.map((setting) => `${setting.key}=${setting.value}`).join(',');
  const [seenSignature, setSeenSignature] = useState(savedSignature);
  if (savedSignature !== seenSignature) {
    setSeenSignature(savedSignature);
    setEdits({});
    setTouched(false);
  }

  const fields: SettingField[] = settings.map((setting) => ({
    setting,
    text: edits[setting.key] ?? String(setting.value),
  }));

  /** The same bounds the API enforces, checked as the admin types. A text setting is checked
   *  against its OWN constraints — length, and whether a line break is legal — because reporting
   *  "debe ser un número entero" for a terms block would be nonsense. */
  const errorFor = ({ setting, text }: SettingField): string | undefined => {
    const raw = text.trim();
    // A switch is one of two values by construction — there is nothing a user can type wrong.
    if (setting.type === 'bool') return undefined;
    if (setting.type === 'text') {
      if (raw.length < setting.minLength) return t(`${KEY}.settings.requiredError`);
      if (raw.length > setting.maxLength) {
        return t(`${KEY}.settings.lengthError`, { max: setting.maxLength });
      }
      return !setting.multiline && /[\r\n]/.test(raw)
        ? t(`${KEY}.settings.singleLineError`)
        : undefined;
    }
    if (!/^\d+$/.test(raw)) return t(`${KEY}.settings.integerError`);
    const value = Number(raw);
    return value < setting.min || value > setting.max
      ? t(`${KEY}.settings.rangeError`, { min: setting.min, max: setting.max })
      : undefined;
  };

  const firstError = fields.map(errorFor).find((message) => message !== undefined);
  // The evidence pair must stay satisfiable — the same cross-field rule the API enforces, because a
  // status inheriting an inverted range could never be satisfied by any photo count. Absent from this
  // group (the orders card) ⇒ nothing to cross-check.
  const textOf = (key: string): string =>
    fields.find((field) => field.setting.key === key)?.text ?? '';
  const min = Number(textOf('orders.evidenceMinPhotos'));
  const max = Number(textOf('orders.evidenceMaxPhotos'));
  const rangeInverted =
    Number.isInteger(min) && Number.isInteger(max) && max < min
      ? t(`${KEY}.settings.invertedError`)
      : undefined;
  const blocking = firstError ?? rangeInverted;
  const dirty = fields.some((field) => field.text !== String(field.setting.value));

  const save = (): void => {
    setTouched(true);
    if (blocking !== undefined || isPending || !dirty) return;
    updateSettings(
      fields.map((field) => ({
        key: field.setting.key,
        // The wire type follows the setting's own type — sending "15" for an integer setting would
        // be rejected by the same validator that rejects 15 for a text one, and the API refuses to
        // coerce `"true"` into a boolean for exactly the same reason.
        value: settingWireValue(field),
      })),
      {
        onSuccess: () => notify.success(t(`${KEY}.toasts.settingsSaved`)),
        onError: (error) => {
          const { inline, toast } = toFormError(error, t(`${KEY}.errors.saveFallback`));
          notify.error(inline ?? toast ?? t(`${KEY}.errors.saveFallback`));
        },
      },
    );
  };

  return (
    // A real `<form>` so Enter saves from any field — see `PreferenceRowForm` for why `noValidate` is
    // required rather than optional here (these inputs carry the API's bounds as `min`/`max`).
    <form
      className="flex flex-col gap-5 py-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((field) => {
          const { setting } = field;
          const leaf = settingLeaf(setting.key);
          const label = t(`${KEY}.settings.${leaf}.label`);
          const invalid = touched && errorFor(field) !== undefined;
          const change = (value: string): void =>
            setEdits((current) => ({ ...current, [setting.key]: value }));
          const multiline = setting.type === 'text' && setting.multiline;
          return (
            // A multiline setting takes the FULL row: a paragraph squeezed into half a grid column
            // wraps every few words, which makes it unreadable exactly where reading it matters.
            // A switch takes it too — its label sits BESIDE the control, so half a column would put
            // a sentence next to a toggle and wrap it into three lines.
            <div
              key={setting.key}
              className={`card-item flex min-w-0 flex-col gap-1 ${
                multiline || setting.type === 'bool' ? 'sm:col-span-2' : ''
              }`}
            >
              {setting.type === 'bool' ? (
                // The switch carries the label itself rather than sitting under a floating one:
                // a toggle whose meaning is above it reads as a heading with an orphaned control.
                <Switch
                  id={`preference-${leaf}`}
                  checked={field.text === 'true'}
                  disabled={isPending}
                  label={label}
                  aria-label={label}
                  onChange={(next) => change(String(next))}
                />
              ) : multiline ? (
                <CustomTextarea
                  id={`preference-${leaf}`}
                  label={label}
                  aria-label={label}
                  // Only a genuinely MULTI-LINE setting gets a textarea (owner, 2026-08-26). Every
                  // single-line one used to get one too, "so the whole group shares one field
                  // language" — but a business name in a text area invites a paragraph the resolver
                  // then rejects, and it costs the phone its keypad. The control should describe the
                  // value, not the card.
                  //
                  // Deliberately NO `maxLength`: a native cap silently swallows the tail of a pasted
                  // block with no explanation, which reads as the app eating text. The mirrored
                  // resolver says so in words instead — the same stance the row editor's note takes.
                  autoGrow
                  value={field.text}
                  disabled={isPending}
                  error={invalid}
                  onChange={(event) => change(event.target.value)}
                />
              ) : setting.type === 'text' ? (
                <CustomInput
                  id={`preference-${leaf}`}
                  type={setting.format === 'phone' ? 'tel' : 'text'}
                  // The value's own kind decides the keyboard — the same rule the client-registry
                  // contact field follows (`CHANNEL_INPUT_MODE`), so a phone is a phone everywhere.
                  inputMode={setting.format === 'phone' ? 'tel' : 'text'}
                  label={label}
                  aria-label={label}
                  value={field.text}
                  disabled={isPending}
                  error={invalid}
                  onChange={(event) => change(event.target.value)}
                />
              ) : (
                <CustomInput
                  id={`preference-${leaf}`}
                  type="number"
                  inputMode="numeric"
                  min={setting.min}
                  max={setting.max}
                  label={label}
                  aria-label={label}
                  value={field.text}
                  disabled={isPending}
                  error={invalid}
                  onChange={(event) => change(event.target.value)}
                />
              )}
              <p className="text-xs leading-relaxed text-charcoal/50">
                {t(`${KEY}.settings.${leaf}.help`)}
              </p>
            </div>
          );
        })}
      </div>

      <AnimatedMessage
        id="preference-settings-error"
        {...(touched && blocking !== undefined && { errorMessage: blocking })}
      />

      <div className="flex justify-end">
        <Button
          type="submit"
          color={SECONDARY_COLOR}
          size="sm"
          loading={isPending}
          // Inert until something changed: a control that always looks ready to save trains people
          // to stop reading it. Disabling the form's default button also makes Enter a no-op, which is
          // the same answer — there is nothing to save.
          disabled={!dirty}
        >
          {t(`${KEY}.settings.save`)}
        </Button>
      </div>
    </form>
  );
};

/** Memoised for the same reason as the catalog card: one card's save re-renders the page, and the
 *  sibling groups have no reason to re-run their own render work for it. */
export default memo(PreferenceSettingsCard);
