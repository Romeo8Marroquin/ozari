import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import AnimatedMessage from '@components/AnimatedMessage';
import Button from '@components/Button';
import Collapse from '@components/Collapse';
import CustomInput from '@components/CustomInput';
import CustomSelect from '@components/CustomSelect';
import SkeletonFade from '@components/SkeletonFade';
import { notify } from '@components/notifications/notify';
import { toFormError } from '@utils/apiError';
import { integerInput } from '@utils/numericInput';
import { parseBilledDays } from '../orders/SchemaCreateOrder';
import SettingRow from './SettingRow';
import SettingsSection from './SettingsSection';
import { useAccountPreferences, useUpdateAccountPreferences } from './useAccountPreferences';

const KEY = 'modules.panel.settings.orders';
const SECONDARY_COLOR = '#262626';
const SKELETON = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

type Mode = 'range' | 'fixed';

/**
 * "Pedidos" in Ajustes — how *I* fill a new order (owner, 2026-11-19: per person, not business-wide:
 * whoever creates orders may deal with clients who usually keep things longer than the dates say).
 *
 * Today one preference: the order form's BILLED DAYS — by the dates (the default: re-derived every
 * time a date changes) or a fixed number every new order starts at. Stored server-side
 * (`/account/preferences`), so it follows the person to every device — unlike "Este dispositivo"
 * below it. Either way the field stays editable on every order; this only decides where it starts.
 *
 * An explicit SAVE rather than save-on-change: the fixed number is typed, and saving "3" on the way
 * to "30" would quietly start the next order at the wrong figure.
 */
const OrderDefaultsSection: React.FC = () => {
  const { t } = useTranslation();
  const { data, isPending } = useAccountPreferences();
  const { updatePreferences, isPending: isSaving } = useUpdateAccountPreferences();
  const saved = data?.orderBilledDays ?? null;

  // The draft, seeded from the saved value the first time it is known and re-seeded after every save
  // (React's "adjust state during render" — loop-free: it only runs when the saved value changes).
  const [seededFrom, setSeededFrom] = useState<number | null | undefined>(undefined);
  const [mode, setMode] = useState<Mode>('range');
  const [daysText, setDaysText] = useState('1');
  const [error, setError] = useState<string | undefined>(undefined);
  if (!isPending && seededFrom !== saved) {
    setSeededFrom(saved);
    setMode(saved === null ? 'range' : 'fixed');
    setDaysText(saved === null ? daysText : String(saved));
  }

  const parsedDays = parseBilledDays(daysText);
  const next = mode === 'range' ? null : (parsedDays ?? undefined);
  const dirty = mode === 'range' ? saved !== null : next !== saved;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (isSaving || !dirty) return;
    if (next === undefined) {
      setError(t(`${KEY}.billedDays.invalid`));
      return;
    }
    setError(undefined);
    updatePreferences(
      { orderBilledDays: next },
      {
        onSuccess: () => notify.success(t(`${KEY}.billedDays.saved`)),
        onError: (failure) => {
          const { inline, toast } = toFormError(failure, t(`${KEY}.billedDays.failed`));
          if (inline) setError(inline);
          if (toast) notify.error(toast);
        },
      },
    );
  };

  return (
    <SettingsSection title={t(`${KEY}.title`)} description={t(`${KEY}.description`)}>
      <div className="divide-y divide-charcoal/[0.06]">
        <SettingRow
          label={t(`${KEY}.billedDays.label`)}
          description={t(`${KEY}.billedDays.description`)}
        >
          <SkeletonFade
            loading={isPending}
            contentClassName="block"
            skeleton={<span aria-hidden className={`inline-block h-11 w-52 ${SKELETON}`} />}
          >
            {/* A real form: Enter in the days field saves, and `noValidate` keeps the browser's own
                bubble out of it (the bounds live in `parseBilledDays`, mirrored from the API). */}
            <form noValidate onSubmit={submit} className="flex flex-col">
              <div className="flex flex-wrap items-start gap-2">
                <div className="w-52 max-w-full">
                  <CustomSelect
                    id="settings-order-billed-days-mode"
                    label={t(`${KEY}.billedDays.modeLabel`)}
                    value={mode}
                    onChange={(event) => {
                      setMode(event.target.value as Mode);
                      setError(undefined);
                    }}
                    options={[
                      { value: 'range', label: t(`${KEY}.billedDays.range`) },
                      { value: 'fixed', label: t(`${KEY}.billedDays.fixed`) },
                    ]}
                  />
                </div>
                {mode === 'fixed' && (
                  <div className="w-24">
                    <CustomInput
                      id="settings-order-billed-days"
                      {...integerInput}
                      label={t(`${KEY}.billedDays.daysLabel`)}
                      aria-label={t(`${KEY}.billedDays.daysLabel`)}
                      error={Boolean(error)}
                      value={daysText}
                      onChange={(event) => {
                        setDaysText(event.target.value);
                        setError(undefined);
                      }}
                    />
                  </div>
                )}
                <Button
                  type="submit"
                  variant="soft"
                  color={SECONDARY_COLOR}
                  size="sm"
                  disabled={!dirty}
                  loading={isSaving}
                  className="mt-1"
                >
                  {t(`${KEY}.billedDays.save`)}
                </Button>
              </div>
              <Collapse open={error !== undefined}>
                {error !== undefined && (
                  <AnimatedMessage id="settings-order-billed-days-error" errorMessage={error} />
                )}
              </Collapse>
            </form>
          </SkeletonFade>
        </SettingRow>
      </div>
    </SettingsSection>
  );
};

export default OrderDefaultsSection;
